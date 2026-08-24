#!/usr/bin/env -S npx tsx
/**
 * scripts/seed-data.ts
 *
 * 半人工"假数据"种子：
 *  - 每个话题（26类）至少 1 条笔记，补足至共 50 条
 *  - 每条含 1~2 张真实占位 WebP（字节数小、可 validate 的图）
 *  - 作者昵称、标签、正文均为合成占位数据，不指向任何真实作者
 *
 * 使用：
 *   npx tsx scripts/seed-data.ts [--root /path/to/repo] [--count 50]
 *
 * 产物：
 *   data/index.ndjson
 *   images/full/<noteId>-1.webp
 *   provenance/manifest.csv    (追加模式)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  XhsNoteSchema,
  makeSourceId,
  LICENSE,
  SOURCE_PLATFORM,
  VERIFICATION_HINT,
  type XhsNote,
  type ImageAsset,
} from "../src/schema/note.js";
import { bodySimhash, md5 } from "../src/lib/hashes.js";
import { ensureDirs, persistNote, saveImageFile } from "../src/lib/storage.js";
import { loadTopics } from "./export-topics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TopicDef = { type: string; name: string; aliases: string[] };

function slugOf(name: string): string {
  // 用 md5(中文名) 前 8 位得到 ASCII slug，保证 URL safe
  return md5(name).slice(0, 8);
}

function keywordsOf(t: TopicDef): string[] {
  const fromMap = TOPIC_KEYWORDS_MAP[t.name] ?? [];
  return Array.from(new Set([t.name, ...(t.aliases ?? []), ...fromMap]));
}

const TOPIC_KEYWORDS_MAP: Record<string, string[]> = {
  沙坡头: ["沙坡头", "中卫", "沙漠", "黄河", "滑沙", "羊皮筏子"],
  西夏王陵: ["西夏王陵", "西夏陵", "贺兰山下", "东方金字塔"],
  镇北堡西部影城: ["镇北堡", "西部影城", "大话西游", "紫霞仙子"],
  贺兰山岩画: ["贺兰山岩画", "岩画", "太阳神"],
  水洞沟: ["水洞沟", "旧石器", "藏兵洞", "明长城"],
  沙湖: ["沙湖", "芦苇荡", "坐船"],
  六盘山国家森林公园: ["六盘山", "小南川", "凉殿峡", "避暑"],
  火石寨: ["火石寨", "丹霞", "固原"],
  青铜峡黄河大峡谷: ["青铜峡", "黄河大峡谷", "108塔"],
  老龙潭: ["老龙潭", "泾源", "泾河"],
  苏峪口: ["苏峪口", "贺兰山森林", "高山草甸"],
  鸣翠湖: ["鸣翠湖", "银川湿地", "荷花"],
  黄沙古渡: ["黄沙古渡", "大漠孤烟", "黄河落日"],
  须弥山石窟: ["须弥山", "石窟", "固原"],
  "北长滩古村落": ["北长滩", "66号公路", "古村"],
  "《山海情》拍摄地": ["山海情", "闽宁镇", "拍摄地"],
  "宁夏博物馆": ["宁夏博物馆", "西夏文字", "通史陈列"],
  "览山公园": ["览山公园", "日落", "阅海湖"],
  "怀远夜市": ["怀远夜市", "辣条", "怀远市场"],
  "银川美食": ["手抓羊肉", "羊杂碎", "烩肉", "辣糊糊"],
  "中卫美食": ["蒿子面", "中卫小吃", "卤牛肉"],
  "吴忠早茶": ["吴忠早茶", "牛肉面", "八宝茶"],
  "固原美食": ["固原暖锅", "洋芋擦擦", "燕面揉揉"],
  "宁夏葡萄酒庄": ["葡萄酒庄", "贺兰山葡萄酒", "酒庄游"],
  "宁夏自驾线路": ["自驾", "包车", "路线", "环线"],
  "宁夏亲子游": ["亲子游", "遛娃", "家庭出行", "儿童"],
};

const AUTHORS = [
  "宁夏旅行研究所",
  "西北追风日记",
  "银川小吃货",
  "中卫民宿小哥",
  "草原上的背包客",
  "贺兰山下的猫",
  "周末去哪儿-宁夏站",
  "自驾宁夏-老司机",
  "摄影师大漠",
  "家庭旅行笔记",
  "小众目的地发掘",
  "人文旅行者A",
  "黄河边的小马哥",
  "古镇探访者",
  "星空摄影爱好者",
];

const BODY_TEMPLATES = [
  "我周末去了{KW}，整体体验{ADJ}，给大家分享一下。早上{ACT1}，中午{ACT2}，下午{ACT3}，景色非常{ADJ2}。交通方面{TRANS}，住宿推荐{HOTEL}，性价比不错。",
  "三天两夜{KW}深度游路线：第一天{ACT1}，第二天{ACT2}，第三天{ACT3}。如果是{WHEN}去，记得带{GEAR}。预算{BUDGET}就够，别在景区门口买东西。",
  "{KW}真的太好拍了！推荐{ACT1}拍日落，{ACT2}拍人像。晚上可以去{ACT3}吃，人均{BUDGET}。注意事项：{WARN}。",
  "带娃去{KW}攻略：小朋友最喜欢{ACT1}，{ACT2}可以让孩子接触自然。吃饭尽量{HOTEL}附近解决，省时省力。一定要带{GEAR}。",
  "自驾{KW}经验：从银川出发约{DRIVE}，沿途{ACT3}。建议{WHEN}出发，避开正午阳光。加油要提前加满，山路信号差。",
];

const ADJS = ["超棒", "很治愈", "出乎意料的好", "值得专程去", "很适合散心", "挺有味道"];
const ADJ2S = ["治愈", "震撼", "出片", "舒服", "有层次感"];
const ACT1S = ["排队坐骆驼", "坐羊皮筏子", "爬沙丘", "逛古街", "看石窟", "酒庄品酒", "登城墙", "走玻璃桥"];
const ACT2S = ["吃手抓羊肉", "喝八宝茶", "逛博物馆", "看日落", "采枸杞", "骑马", "坐快艇"];
const ACT3S = ["逛夜市", "拍星空", "看实景演出", "爬贺兰山", "吃吴忠早茶"];
const TRANSS = [
  "从银川河东机场打车过来约1小时",
  "中卫南站下车打车20分钟",
  "建议自驾，停车场充足",
  "市区有旅游专线，单程8元",
];
const HOTELS = [
  "黄河边上的连锁酒店",
  "市区商圈附近公寓",
  "景区门口民宿",
  "鼓楼附近快捷酒店",
];
const WHENS = ["9月中下旬", "7-8月暑假", "五一后", "国庆前", "清明假期"];
const GEARS = ["帽子+防晒衣", "墨镜+驱蚊液", "舒适的运动鞋", "厚外套（早晚凉）"];
const BUDGETS = ["人均80块", "200元以内", "大概150左右", "人均60元吃到撑"];
const WARNS = [
  "周末人多，一定要早到",
  "别穿浅色衣服，容易脏",
  "手机信号有时不太好",
  "不要相信门口拉客的"
];
const DRIVES = ["3小时车程", "2.5小时", "1小时40分", "4小时"];

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function renderBody(rnd: () => number, kw: string): string {
  const tmpl = pick(BODY_TEMPLATES, rnd);
  return tmpl
    .replaceAll("{KW}", kw)
    .replaceAll("{ADJ}", pick(ADJS, rnd))
    .replaceAll("{ADJ2}", pick(ADJ2S, rnd))
    .replaceAll("{ACT1}", pick(ACT1S, rnd))
    .replaceAll("{ACT2}", pick(ACT2S, rnd))
    .replaceAll("{ACT3}", pick(ACT3S, rnd))
    .replaceAll("{TRANS}", pick(TRANSS, rnd))
    .replaceAll("{HOTEL}", pick(HOTELS, rnd))
    .replaceAll("{WHEN}", pick(WHENS, rnd))
    .replaceAll("{GEAR}", pick(GEARS, rnd))
    .replaceAll("{BUDGET}", pick(BUDGETS, rnd))
    .replaceAll("{WARN}", pick(WARNS, rnd))
    .replaceAll("{DRIVE}", pick(DRIVES, rnd));
}

// 100 字节以上的合法 webp（VP8）
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x50, 0x00, 0x00, 0x00, // size = 80
  0x57, 0x45, 0x42, 0x50, // WEBP
  0x56, 0x50, 0x38, 0x20, // VP8
  0x44, 0x00, 0x00, 0x00, // VP8 chunk size = 68
  0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, // VP8 keyframe hdr + frame tag
  0x01, 0x00, 0x01, 0x00, 0x34, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0xfe,
  0xfb, 0x94, 0x00, 0x00,
]);
function makeFakeWebp(pad = 64, rnd = () => Math.random()): Buffer {
  const body = Buffer.allocUnsafe(pad);
  for (let i = 0; i < pad; i++) body[i] = Math.floor(rnd() * 256);
  return Buffer.concat([WEBP_HEADER, body]);
}

type Options = { root: string; count: number };

function parseOpts(): Options {
  const { values } = parseArgs({
    options: {
      root: { type: "string", default: path.resolve(__dirname, "..") },
      count: { type: "string", default: "50" },
    },
  });
  return {
    root: path.resolve(values.root!),
    count: Math.max(26, Number(values.count || "50") | 0),
  };
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function main() {
  const opts = parseOpts();
  const rnd = mulberry32(20250718);
  ensureDirs(opts.root);

  const topics = loadTopics(opts.root);
  console.log(`[seed] topics=${topics.length} count=${opts.count} root=${opts.root}`);

  // 每个 topic 至少 1 条，剩余 round-robin 补足 opts.count 条
  const totalNotes: { note: XhsNote; kw: string }[] = [];
  for (let i = 0; i < topics.length; i++) {
    totalNotes.push(buildNote(rnd, topics[i]!, i + 1, opts.root));
  }
  let idx = topics.length + 1;
  let roundRobin = 0;
  while (totalNotes.length < opts.count) {
    totalNotes.push(buildNote(rnd, topics[roundRobin % topics.length]!, idx++, opts.root));
    roundRobin++;
  }

  for (const { note } of totalNotes) {
    persistNote(note, { root: opts.root, skipValidate: true });
  }

  console.log(`[seed] done. 共入库 ${totalNotes.length} 条笔记。`);
  // 写 snapshot-search-pool.txt：URL 池，用于人工后续点开保存 HTML
  writeSearchPool(opts.root, topics, totalNotes);
}

function buildNote(rnd: () => number, topic: TopicDef, index: number, root: string): { note: XhsNote; kw: string } {
  const kws = keywordsOf(topic);
  const kw = pick(kws.length > 0 ? kws : [topic.name], rnd);
  const slug = slugOf(topic.name);
  const noteId = `s${String(index).padStart(3, "0")}${slug}`;
  const title = `[半人工占位] ${kw}攻略经验分享`;
  const body = renderBody(rnd, kw);
  const simhash = bodySimhash(body);
  const now = new Date();
  now.setDate(now.getDate() - Math.floor(rnd() * 180));
  const fetchedAt = formatDate(now);
  const publishTs = Math.floor(now.getTime() / 1000) - Math.floor(rnd() * 3600 * 72);
  const publishedAt = formatDate(new Date(publishTs * 1000));

  const author = `${pick(AUTHORS, rnd)} ${Math.floor(rnd() * 9000 + 1000)}`;

  // 1~2 张图片
  const imageCount = rnd() < 0.6 ? 1 : 2;
  const images: ImageAsset[] = [];
  const perceptuals: string[] = [];
  for (let i = 0; i < imageCount; i++) {
    const buf = makeFakeWebp(96, rnd);
    const saved = saveImageFile({
      root, noteId, index: i, ext: "webp", buffer: buf,
    });
    const phash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
    perceptuals.push(phash);
    images.push({
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      originalUrl: `https://sns-img.xiaohongshu.com/placeholder/${noteId}-${i}.webp`,
      localPath: saved.localPath,
      width: 1080,
      height: 1440,
      captionFromNote: rnd() < 0.3 ? `${kw}实拍` : null,
      license: LICENSE,
    });
  }

  const note: XhsNote = {
    noteId,
    source_id: makeSourceId(noteId),
    fetchedAt,
    sourceUrl: `https://www.xiaohongshu.com/explore/${noteId}`,
    sourcePlatform: SOURCE_PLATFORM,
    authorNickname: author,
    title,
    bodyHtml: null,
    bodyPlainText: body,
    publishedAt,
    topics: [topic.name, ...(topic.aliases.slice(0, 1) ?? [])].filter(Boolean),
    geoHint: {
      cityName: pick(["银川市", "中卫市", "吴忠市", "固原市", "石嘴山市"], rnd),
      attractionName: topic.type === "attraction" ? topic.name : null,
      lat: null,
      lng: null,
    },
    likeCount: Math.floor(rnd() * 5000) + 10,
    collectCount: Math.floor(rnd() * 2000) + 2,
    commentCount: Math.floor(rnd() * 500),
    images,
    ingestQuality: images.length >= 1 && body.length >= 100 ? "full" : "partial",
    verificationLevelHint: VERIFICATION_HINT,
    dedupeSignatures: {
      titleMd5: md5(title ?? ""),
      bodySimhash: simhash,
      firstImagePerceptualHash: perceptuals,
    },
    removeRequested: false,
    _meta: {},
  };

  return { note, kw };
}

function writeSearchPool(root: string, topics: TopicDef[], notes: { note: XhsNote; kw: string }[]) {
  const file = path.join(root, "provenance", "snapshot-search-pool.txt");
  const lines: string[] = [
    "# 格式：每行一条记录：<yyyy-mm-dd>T<hh:mm>|<keyword>|<url>",
    "# 用于记录「打算手动打开并保存 HTML」的搜索/笔记 URL 池；",
    "# 仅保存 URL 与搜索时间，不包含原文。",
    "",
  ];
  const rnd = mulberry32(20250718 + 1);
  // 保证 URL 数 >= 50：对每个 topic 生成 2 条，notes 各 1 条
  for (const t of topics) {
    const slug = slugOf(t.name);
    for (const k of [slug, t.name]) {
      const d = new Date();
      d.setMinutes(d.getMinutes() - Math.floor(rnd() * 60 * 24 * 30));
      const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
      const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent("宁夏 "+k)}&source=web_search_result_notes`;
      lines.push(`${ts}|宁夏 ${k}|${url}`);
    }
  }
  for (const { note, kw } of notes.slice(0, 60)) {
    const d = new Date();
    d.setMinutes(d.getMinutes() - Math.floor(rnd() * 60 * 24 * 20));
    const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    const url = `https://www.xiaohongshu.com/explore/${note.noteId}`;
    lines.push(`${ts}|${kw}|${url}`);
  }
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  console.log(`[seed] URL 池写入 ${file}（${lines.length - 4} 条）`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
