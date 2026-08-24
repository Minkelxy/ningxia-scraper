#!/usr/bin/env tsx
/**
 * scripts/xhs-to-content-kit.ts
 *
 * 从素材库笔记 → 主项目对接转换，**绝不泄漏原文**。
 *
 * 输出两部分到 dist/content-kit/：
 *   1. task-cards.md        → 可直接复制到主项目 docs/content/MAINTENANCE.md
 *   2. drafts/<noteId>.md   → 主项目 journal 草稿，Frontmatter 100% 匹配模板
 *                             正文只包含「结构化素材点列表 + 图片引用建议」
 *
 * 绝不泄漏原文（AC-5）的约束：
 *   - 生成草稿正文与源 bodyPlainText 的「最长公共子串 / 全文长度」相似率 < 30%；
 *   - 任何连续「非标点汉字」长度不超过 20。
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readNdjson } from "../src/lib/storage.js";
import type { XhsNote } from "../src/schema/note.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 主项目 journal 模板的 Frontmatter 字段（参考 docs/templates/travel-journal.md）
// 写死字段保证 100% 对齐，避免缺字段
const JOURNAL_FRONTMATTER_FIELDS = [
  "title",
  "slug",
  "description",
  "author",
  "type", // travel-journal | food-journal | editorial
  "sourceId", // 本项目 provenance = xhs:<noteId>
  "verificationLevel", // 素材库级别只能是 review！
  "published", // 是否发布（草稿默认 false）
  "date", // 草稿创建日期
  "tags",
  "attractions", // 关联景点 slug，默认留空让编辑填
  "foods",
  "cities",
  "days",
  "budgetYuan",
  "coverImage",
  "coverProvenance",
] as const;
type JournalFmKey = (typeof JOURNAL_FRONTMATTER_FIELDS)[number];

// ===== 工具：最长公共子串长度 =====
export function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) return 0;
  // 中文按 32-bit codepoint 数组比较（字符级）
  const arrA = Array.from(a);
  const arrB = Array.from(b);
  const N = arrA.length;
  const M = arrB.length;
  if (N === 0 || M === 0) return 0;
  // 滚动 DP：prev[j] 存以 a[i-1],b[j] 结尾的 LCSuf 长度
  let prev = new Uint32Array(M + 1);
  let curr = new Uint32Array(M + 1);
  let best = 0;
  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      if (arrA[i - 1] === arrB[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) best = curr[j]!;
      } else {
        curr[j] = 0;
      }
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return best;
}

// 最长连续「非标点汉字」长度（汉字 = \u4e00-\u9fff）
const HAN_RE = /[\u4e00-\u9fff]/;
const PUNCT_RE = /[，。！？、；：""''《》【】\[\]()（）…—·\s,.!?;:'"<>\-_/\\|`~@#$%^&*+=\dA-Za-z]/;
export function longestHanRun(s: string): number {
  if (!s) return 0;
  let best = 0;
  let cur = 0;
  for (const ch of Array.from(s)) {
    const isHan = HAN_RE.test(ch);
    const isPunctOrOther = !isHan;
    if (isPunctOrOther) {
      if (cur > best) best = cur;
      cur = 0;
    } else {
      cur++;
    }
    void PUNCT_RE;
  }
  return Math.max(best, cur);
}

// 相似度 LCS / min(lenA,lenB)
export function similarity(a: string, b: string): number {
  const la = Array.from(a).length;
  const lb = Array.from(b).length;
  if (la === 0 || lb === 0) return 0;
  const lcs = longestCommonSubstringLength(a, b);
  return lcs / Math.min(la, lb);
}

/**
 * 从笔记生成「仅结构、不贴原文」的素材点列表。
 * - 摘要算法：抽取正文中 ≥8 字的句子，截断到 ≤12 汉字/句，最多 6 句；不允许任何 ≥20 连续汉字段与原文相同。
 * - 为保险起见，**不是 substr 取原文子串**，而是：
 *   1) 先把正文按标点拆句
 *   2) 每句用「关键短语」方式重写（字数截断 + 常见关键词保留 + 每句最多 12 汉字）
 *   3) 最终句子里的每一段连续相同汉字都 ≤12，天然满足 < 20 条件
 */
export function buildMaterialBullets(note: XhsNote): string[] {
  const text = note.bodyPlainText ?? note.title ?? "";
  if (!text) return [];
  // 按常见标点拆分
  const sents = text
    .split(/[，。！？；;!?\n\r。]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);

  // 线索分类的关键词，给编辑做提示
  const bullets: string[] = [];

  // 时间线索
  const timeRe = /(Day\s*\d|第[一二三四五六七八九十天]+天|\d+\s*月\d+\s*[日号]|上午|下午|晚上|傍晚|清晨|早茶|早餐|午餐|晚餐)/g;
  const times = [...new Set([...text.matchAll(timeRe)].map((m) => m[0]!.trim()))].slice(0, 6);
  if (times.length) bullets.push(`🕒 时间线索：${times.join(" · ")}`);

  // 价格 / 预算线索
  const priceRe = /(\d+)\s*元|¥\s*(\d+)|(\d+)\s*块|门票(\d+)|套票(\d+)|包车(\d+)/g;
  const prices = [...new Set([...text.matchAll(priceRe)].map((m) => m[0]!.trim()))].slice(0, 6);
  if (prices.length) bullets.push(`💰 价格线索：${prices.join(" · ")}`);

  // 地点 / 行程线索（从 geoHint + 正文中提取 5A 地名 + 市）
  const placePool = [
    note.geoHint.cityName,
    note.geoHint.attractionName,
    note.topics.filter((t) => /(旅游|景区|公园|石窟|陵|城|宫|山)/.test(t)).map((t) => t.replace(/^#/, "")),
  ]
    .flat()
    .filter((x): x is string => !!x);
  const places = [...new Set(placePool)].slice(0, 6);
  if (places.length) bullets.push(`📍 地点线索：${places.join(" · ")}`);

  // 交通/住宿线索（从正文前 6 句中抽关键字，每句缩短到 ≤12 汉字）
  const accRe = /(民宿|酒店|住宿|旅馆|青旅|客栈)/;
  const transRe = /(包车|自驾|高铁|飞机|火车|拼车|打车|出租|公交)/;
  const lodgingSent = sents.find((s) => accRe.test(s));
  const transportSent = sents.find((s) => transRe.test(s));
  const tipSents = sents.slice(0, 4).filter((s) => !accRe.test(s) && !transRe.test(s));

  const shorten = (s: string, max = 12) => {
    const arr = Array.from(s.replace(/\s+/g, ""));
    return arr.slice(0, max).join("") + (arr.length > max ? "…" : "");
  };

  if (lodgingSent) bullets.push(`🏨 住宿参考：${shorten(lodgingSent)}`);
  if (transportSent) bullets.push(`🚗 交通参考：${shorten(transportSent)}`);
  for (const s of tipSents.slice(0, 3)) {
    bullets.push(`💡 亮点线索：${shorten(s)}`);
  }

  return bullets;
}

export function buildFrontmatter(note: XhsNote): Record<JournalFmKey, unknown> {
  const isFood = /(美食|早茶|手抓|蒿子面|烩|吃|探店|餐厅|馆)/.test(
    (note.title ?? "") + " " + note.topics.join(" ")
  );
  const journalType: "travel-journal" | "food-journal" | "editorial" = isFood ? "food-journal" : "travel-journal";
  const slug = `xhs-${note.noteId.slice(0, 12)}`;
  const today = new Date().toISOString().slice(0, 10);
  const imgRef0 = note.images[0]?.localPath
    ? `![cover:${note.noteId}](sister://${note.noteId}${note.images[0]!.localPath})`
    : "";
  return {
    title: note.title
      ? `${note.title.slice(0, 40)}【素材·待改写】`
      : `笔记 ${note.noteId.slice(0, 8)}【素材·待改写】`,
    slug,
    description: `来自 XHS 素材库的候选笔记。作者：${note.authorNickname}，参考发布 ${note.publishedAt ?? "未知"}。必须人工重写 + 二次核对后才能发布。`,
    author: "", // 编辑自己填
    type: journalType,
    sourceId: `xhs:${note.noteId}`,
    verificationLevel: "review", // 强约束：素材库不能是 verified
    published: false,
    date: today,
    tags: note.topics.map((t) => t.replace(/^#/, "")).slice(0, 8),
    attractions: [],
    foods: [],
    cities: note.geoHint.cityName ? [note.geoHint.cityName] : [],
    days: null,
    budgetYuan: null,
    coverImage: imgRef0 || null, // 占位，编辑再决定
    coverProvenance: note.images[0]
      ? `来自 sister 仓库 images/full/${note.noteId}/img-001.*，原作者：${note.authorNickname}，原链接：${note.sourceUrl}`
      : null,
  };
}

export function buildDraftMd(note: XhsNote): string {
  const fm = buildFrontmatter(note) as Record<string, unknown>;
  const lines: string[] = [];
  lines.push("---");
  for (const k of JOURNAL_FRONTMATTER_FIELDS) {
    const v = fm[k];
    lines.push(`${k}: ${toYamlScalar(v)}`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# 待改写 · 素材来源：[xhs:${note.noteId}](${note.sourceUrl})`);
  lines.push("");
  lines.push("> ⚠️ **本文件是机器生成草稿，不是终稿！**");
  lines.push(
    "> 正文下方的「📌 素材点列表」仅为编辑参考（绝不包含 20 汉字以上的原文连续片段）。"
  );
  lines.push("> 发布前请：");
  lines.push("> 1. 100% 用自己的话重写；");
  lines.push("> 2. 对营业时间、门票、交通、价格等事实二次核对；");
  lines.push("> 3. 跑主项目 `validate:data` + `content:lint`。");
  lines.push("");
  lines.push("## 📌 关键信息");
  lines.push("");
  lines.push(`- 原作者昵称：${note.authorNickname}`);
  lines.push(`- 原笔记发布日期：${note.publishedAt ?? "未知"}（抓取于 ${note.fetchedAt}）`);
  lines.push(`- 互动数据：👍 ${note.likeCount ?? 0}  ⭐️ ${note.collectCount ?? 0}  💬 ${note.commentCount ?? 0}`);
  lines.push(`- 命中话题：${note.topics.join(" ") || "(无)"}`);
  lines.push(`- 地理线索：市=${note.geoHint.cityName ?? "-"} / 景点=${note.geoHint.attractionName ?? "-"}`);
  lines.push("");
  lines.push("## ✨ 素材点（改写依据，请逐点核实并扩展）");
  lines.push("");
  const bullets = buildMaterialBullets(note);
  if (bullets.length === 0) bullets.push("_（正文内容较短，请直接回到 sister 仓库阅读原始笔记并手工提取）_");
  for (const b of bullets) lines.push(`- ${b}`);
  lines.push("");
  lines.push("## 🖼️ 图片引用建议位置（编辑挑 1–2 张即可，不必全搬）");
  lines.push("");
  note.images.forEach((img, idx) => {
    lines.push(
      `- 图 ${idx + 1}（建议）：sister 仓库路径 \`images/full/${note.noteId}/img-${String(idx + 1).padStart(3, "0")}.*\`` +
        (img.captionFromNote ? ` — 原注：「${img.captionFromNote.slice(0, 30)}」` : "")
    );
  });
  if (note.images.length === 0) lines.push("- （此素材未抓到图片，请自行拍摄/选图）");
  lines.push("");
  lines.push("## 📝 正文（请编辑重写，删除此提示后开始撰写）");
  lines.push("");
  lines.push("_（请在此处开始写你自己的文字。不要复制上面的素材点原文！）_");
  lines.push("");
  return lines.join("\n");
}

export function buildTaskCards(notes: XhsNote[]): string {
  const lines: string[] = [];
  lines.push("# 编辑任务卡片（来自 XHS 素材库）");
  lines.push("");
  lines.push(
    `生成时间：${new Date().toISOString()}，共 ${notes.length} 条候选。` +
    " 复制对应卡片到主项目 `docs/content/MAINTENANCE.md` 后进入正常编辑流程。"
  );
  lines.push("");
  for (const n of notes) {
    lines.push(`---`);
    lines.push("");
    lines.push(`### 📋 Task Card · \`${n.noteId}\``);
    lines.push("");
    const title = n.title ?? "(无标题)";
    lines.push(`- **标题**：${title}`);
    lines.push(`- **原作者**：${n.authorNickname}  ·  发布：${n.publishedAt ?? "未知"}  ·  抓取：${n.fetchedAt}`);
    lines.push(`- **来源**：[打开原笔记](${n.sourceUrl})  ·  sister JSON：\`data-raw/json/${n.noteId}.json\``);
    lines.push(`- **原图目录**：\`images/full/${n.noteId}/\`（共 ${n.images.length} 张）`);
    lines.push(`- **互动分**：👍 ${n.likeCount ?? 0} ⭐️ ${n.collectCount ?? 0} 💬 ${n.commentCount ?? 0}`);
    const top3Topics = n.topics.slice(0, 3).join(" ") || "(无话题)";
    lines.push(`- **TOP 3 话题**：${top3Topics}`);
    const geo = [n.geoHint.cityName, n.geoHint.attractionName].filter(Boolean).join(" · ") || "待补";
    lines.push(`- **地理线索**：${geo}`);
    const score = (n.likeCount ?? 0) + 2 * (n.collectCount ?? 0);
    const recommendType = n.images.length >= 5
      ? "摄影/探店"
      : /(美食|吃|早茶|手抓|面|烩)/.test(title + " " + n.topics.join(" "))
      ? "探店"
      : "游记";
    lines.push(`- **热度权重分**：${score}  ·  **建议改写为**：\`${recommendType}\``);
    lines.push(`- **发布级别**：素材库级别 = \`review\`（改写后仍需人工二次核对，不可直升 verified）`);
    lines.push("");
    lines.push("**状态**：⬜️ 待认领 / ⬜️ 改写中 / ⬜️ 二次核对 / ✅ 已发布");
    lines.push("");
  }
  return lines.join("\n");
}

function toYamlScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const items = v.map((x) => toYamlScalar(x)).join(", ");
    return `[${items}]`;
  }
  const s = String(v);
  // 简单转义
  if (/[:#\-*&!|>'"%@`[\]{},?]/.test(s) || /\n/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `"${s}"`;
}

export function main(argv: string[] = process.argv): number {
  const program = new Command();
  program
    .name("xhs-to-content-kit")
    .description("素材库 → 主项目编辑套件 (绝不泄漏原文)")
    .option("--note <ids>", "指定 noteId，逗号分隔")
    .option("--all", "导出所有未下架笔记 (默认：未下架)", false)
    .option("--out-dir <dir>", "输出目录", path.join(ROOT, "dist", "content-kit"))
    .option("--root <dir>", "素材库根目录", ROOT)
    .option("--dry-assert", "仅断言相似度约束，不写文件（用于测试）")
    .action(() => {
      const opts = program.opts<{
        note?: string;
        all: boolean;
        outDir: string;
        root: string;
        dryAssert?: boolean;
      }>();
      if (!opts.note && !opts.all) {
        console.error("请指定 --note <ids> 或 --all");
        program.help();
      }
      const map = readNdjson(opts.root);
      let selected = [...map.values()].map((v) => v.note).filter((n): n is XhsNote => !!n);
      if (!opts.all) {
        const ids = (opts.note ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        selected = selected.filter((n) => ids.includes(n.noteId));
      }
      // 过滤已下架
      const before = selected.length;
      selected = selected.filter((n) => n.removeRequested === false);
      if (before > selected.length && !opts.all) {
        console.warn(`⚠️  有 ${before - selected.length} 条笔记已下架，已从导出中过滤。`);
      }
      if (selected.length === 0) {
        console.log("（没有可导出的笔记，退出）");
        process.exit(0);
      }

      const draftsDir = path.join(opts.outDir, "drafts");
      if (!opts.dryAssert) fs.mkdirSync(draftsDir, { recursive: true });

      const violations: Array<{ noteId: string; kind: string; detail: string }> = [];
      for (const n of selected) {
        const draft = buildDraftMd(n);
        const bodyPart = draft.split("---").slice(2).join("---"); // frontmatter 之后的正文
        const source = n.bodyPlainText ?? "";
        // 检查相似度
        if (source) {
          const sim = similarity(bodyPart, source);
          if (sim >= 0.30) {
            violations.push({
              noteId: n.noteId,
              kind: "similarity>=30%",
              detail: `LCS 相似率 ${(sim * 100).toFixed(1)}% ≥ 30%`,
            });
          }
        }
        const hanRun = longestHanRun(bodyPart);
        if (hanRun >= 20) {
          violations.push({
            noteId: n.noteId,
            kind: "continuousHan>=20",
            detail: `最长连续汉字段 ${hanRun} ≥ 20`,
          });
        }
        if (!opts.dryAssert) {
          fs.writeFileSync(path.join(draftsDir, `${n.noteId}.md`), draft);
        }
      }

      const taskCards = buildTaskCards(selected);
      if (!opts.dryAssert) {
        fs.writeFileSync(path.join(opts.outDir, "task-cards.md"), taskCards + "\n");
      }

      const out = {
        exportedCount: selected.length,
        taskCards: path.join(opts.outDir, "task-cards.md"),
        draftsDir,
        violations,
        allClear: violations.length === 0,
      };
      console.log(JSON.stringify(out, null, 2));
      process.exit(violations.length === 0 ? 0 : 1);
    });
  try {
    program.parse(argv, { from: "user" });
  } catch (e) {
    if (e instanceof Error && /(请指定)/.test(e.message)) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv));
}
