#!/usr/bin/env tsx
/**
 * scripts/crawl-wikipedia.ts
 *
 * 真爬真实网站 zh.wikipedia.org 的宁夏相关词条,落到本仓库 data-raw/wikipedia/,
 * 并渲染成 docs/wikipedia/<slug>.md 可在 GitHub 直接浏览。
 *
 * 数据来源(全部通过 zh.wikipedia.org 公开 Action API 抓取,
 * 严格遵守 Wikipedia CC BY-SA 3.0 协议,保留原作者署名与原文链接):
 *   1. 精选清单:宁夏行政区划、地理、景点、交通等核心词条
 *   2. 搜索补全:用 list=search srsearch="宁夏" 发现更多词条
 *   每个词条:
 *     - prop=extracts (explaintext=1, exsectionformat=wiki)  → 全文纯文本 + 段落标记
 *     - prop=pageimages (piprop=thumbnail|original)          → 首图缩略图 (热链 upload.wikimedia.org)
 *     - prop=info    (inprop=url)                            → canonical URL
 *
 * 合规:Wikipedia 文本以 CC BY-SA 3.0 发布,允许转载但必须署名 + 共享相同协议;
 *       Wikimedia Commons 图片各自有授权,本脚本只做缩略图热链,不下载存储,
 *       在每页脚注标注来源与协议。
 *
 * 用法:
 *   npm run crawl:wikipedia
 *   npm run crawl:wikipedia -- --max-articles 60 --out-dir docs/wikipedia
 *   npm run crawl:wikipedia -- --search-query 沙坡头 --search-limit 20
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Wikipedia 要求 User-Agent 带可联系的项目地址 + 协议声明
const UA =
  "MinkelxyNingxiaCrawler/1.0 (https://github.com/Minkelxy/ningxia-tourism; contact: Minkelxy@users.noreply.github.com) wikipedia-cc-by-sa-mirror";

const API = "https://zh.wikipedia.org/w/api.php";

// 精选清单:宁夏行政区划(5 市 + 县区)、地理(山/河/湖)、景点、交通、文化
const SEED_TITLES: string[] = [
  // 行政区划
  "宁夏回族自治区",
  "银川市", "石嘴山市", "吴忠市", "固原市", "中卫市",
  "灵武市", "青铜峡市",
  "永宁县", "贺兰县", "平罗县",
  "盐池县", "同心县", "红寺堡区",
  "中宁县", "海原县",
  "西吉县", "隆德县", "泾源县", "彭阳县",
  "兴庆区", "金凤区", "西夏区", "原州区", "惠农区", "大武口区",
  // 自然地理
  "贺兰山", "六盘山", "沙坡头", "沙湖", "青铜峡", "黄河", "清水河",
  // 人文景点
  "西夏王陵", "镇北堡西部影城", "水洞沟", "须弥山石窟", "一百零八塔",
  "贺兰山岩画", "滚钟口", "苏峪口", "中卫高庙", "南关清真大寺",
  "宁夏博物馆", "沙坡头自然保护区",
  // 交通
  "银川河东国际机场", "中卫沙坡头机场", "银西高速铁路", "包兰铁路",
  // 文化 / 教育
  "宁夏大学", "西夏", "宁夏回族自治区历史",
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiGet(params: Record<string, string>): Promise<any> {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 429 || r.status >= 500) {
        const retry = parseInt(r.headers.get("retry-after") || "2", 10);
        await sleep((retry || 2) * 1000);
        continue;
      }
      if (!r.ok) {
        throw new Error(`HTTP ${r.status} on ${url.pathname}?${url.searchParams.get("action")}`);
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function searchTitles(query: string, limit: number): Promise<string[]> {
  const j = await apiGet({
    action: "query",
    list: "search",
    srsearch: query,
    srnamespace: "0", // 只搜主名字空间
    srlimit: String(limit),
    srprop: "", // 不需要 snippet,省带宽
  });
  return (j?.query?.search ?? []).map((s: any) => s.title as string);
}

type WikiArticle = {
  title: string;
  pageid: number;
  extract: string; // 纯文本正文(含 == 段名 == 标记)
  thumbUrl: string | null; // 首图(优先 thumbnail,回退 original)
  thumbWidth: number | null;
  thumbHeight: number | null;
  canonicalUrl: string;
  touched: string; // ISO 时间戳
  lastrev: number | null;
  fetchedAt: string;
};

async function fetchArticles(titles: string[], fetchedAt: string): Promise<WikiArticle[]> {
  const out: WikiArticle[] = [];
  // 分批,每批最多 20 个 title(Wikipedia 单次 titles 上限 50,20 更稳)
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const j = await apiGet({
      action: "query",
      prop: "extracts|pageimages|info",
      titles: batch.join("|"),
      explaintext: "1",
      exsectionformat: "wiki", // 保留 == 段名 == 标记便于转 Markdown
      piprop: "thumbnail|original",
      pithumbsize: "1200",
      inprop: "url",
    });
    const pages: any[] = j?.query?.pages ?? [];
    for (const p of pages) {
      if (!p || p.missing) continue;
      out.push({
        title: p.title,
        pageid: p.pageid,
        extract: p.extract ?? "",
        thumbUrl: p.thumbnail?.source ?? p.original?.source ?? null,
        thumbWidth: p.thumbnail?.width ?? p.original?.width ?? null,
        thumbHeight: p.thumbnail?.height ?? p.original?.height ?? null,
        canonicalUrl:
          p.fullurl ?? `https://zh.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
        touched: p.touched ?? "",
        lastrev: p.lastrevid ?? null,
        fetchedAt,
      });
    }
    await sleep(100); // 礼貌限速
  }
  return out;
}

function slugify(title: string): string {
  // 保留中文,只去掉文件名非法字符;空格 → _
  return title.replace(/\s+/g, "_").replace(/[\/\\:*?"<>|]/g, "");
}

function convertExtractToMarkdown(extract: string): string {
  // exsectionformat=wiki 时段落标题形如:== 段名 == / === 子段 === / ==== 更深 ====
  // 转 Markdown:## 段名 / ### 子段 / ...
  return (extract || "(无正文)").replace(
    /^(={2,6})\s*(.+?)\s*\1\s*$/gm,
    (_match, marks: string, title: string) => {
      const level = marks.length; // 2..6
      return `${"#".repeat(level)} ${title.trim()}`;
    }
  );
}

function renderArticle(a: WikiArticle): string {
  const lines: string[] = [];
  lines.push(`# ${a.title}`);
  lines.push("");
  lines.push(
    "> ℹ️ **来源说明**:本页内容由 [`crawl-wikipedia.ts`](../../scripts/crawl-wikipedia.ts) 从 [zh.wikipedia.org](https://zh.wikipedia.org) 真实抓取。Wikipedia 文本以 [CC BY-SA 3.0 协议](https://creativecommons.org/licenses/by-sa/3.0/deed.zh) 发布,转载须署名 + 以相同协议共享。原作者地址见下表。"
  );
  lines.push("");
  lines.push("| 字段 | 值 |");
  lines.push("|------|-----|");
  lines.push(`| 词条标题 | ${a.title} |`);
  lines.push(`| 原文链接 | [${a.canonicalUrl}](${a.canonicalUrl}) |`);
  lines.push(`| pageid | \`${a.pageid}\` |`);
  if (a.lastrev) lines.push(`| 最近修订 | \`${a.lastrev}\` |`);
  if (a.touched) lines.push(`| 最近更新(UTC) | ${a.touched} |`);
  lines.push(`| 抓取日期(UTC) | ${a.fetchedAt} |`);
  lines.push(`| 正文长度 | ${a.extract.length} 字符 |`);
  lines.push("");

  if (a.thumbUrl) {
    const dim =
      a.thumbWidth && a.thumbHeight ? ` (${a.thumbWidth}×${a.thumbHeight})` : "";
    lines.push(`![${a.title} 首图](${a.thumbUrl})`);
    lines.push("");
    lines.push(`<sub>首图来源:${a.thumbUrl} · 遵循原作者授权</sub>`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 正文");
  lines.push("");
  lines.push(convertExtractToMarkdown(a.extract).trim());
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    `← [返回全量目录](./INDEX.md) · [返回总览](../BROWSE.md) · [在 Wikipedia 查看原文](${a.canonicalUrl})`
  );
  lines.push("");
  return lines.join("\n");
}

function renderIndex(arts: WikiArticle[]): string {
  const lines: string[] = [];
  lines.push("# 📚 Wikipedia · 宁夏相关词条目录");
  lines.push("");
  lines.push(
    `> 来源:[zh.wikipedia.org](https://zh.wikipedia.org) · 共 ${arts.length} 条 · 抓取于 ${arts[0]?.fetchedAt ?? new Date().toISOString().slice(0, 19)} UTC · CC BY-SA 3.0`
  );
  lines.push("");
  lines.push(
    "所有页面已镜像到本仓库,无需访问外网即可在 GitHub 上直接浏览。每页含首图(热链 upload.wikimedia.org)与全文纯文本。"
  );
  lines.push("");
  lines.push("| # | 标题 | 正文长度 | 首图 | 浏览 |");
  lines.push("|---|------|----------|------|------|");
  const sorted = [...arts].sort((a, b) => b.extract.length - a.extract.length);
  sorted.forEach((a, i) => {
    const hasImg = a.thumbUrl ? "✅" : "—";
    lines.push(
      `| ${i + 1} | ${a.title} | ${a.extract.length} | ${hasImg} | [查看](./${slugify(a.title)}.md) |`
    );
  });
  lines.push("");
  lines.push("← [返回总览](../BROWSE.md)");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const program = new Command();
  program
    .name("crawl-wikipedia")
    .description("从 zh.wikipedia.org 真爬宁夏相关词条,镜像到 docs/wikipedia/")
    .option("--max-articles <n>", "单次最多抓取词条数(防止失控)", "60")
    .option("--root <dir>", "本仓库根", ROOT)
    .option("--out-dir <dir>", "渲染输出目录", "docs/wikipedia")
    .option("--raw-dir <dir>", "原始落盘目录", "data-raw/wikipedia")
    .option("--search-query <q>", "搜索补全关键词", "宁夏")
    .option("--search-limit <n>", "搜索补全结果数", "30")
    .parse(process.argv);

  const opts = program.opts();
  const root = path.resolve(opts.root);
  const outDir = path.resolve(root, opts.outDir);
  const rawDir = path.resolve(root, opts.rawDir);
  const maxArticles = parseInt(opts.maxArticles, 10);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  // 清空旧的渲染产物,避免删除词条后还留陈旧文件
  for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith(".md")) fs.unlinkSync(path.join(outDir, f));
  }

  const fetchedAt = new Date().toISOString().slice(0, 19);

  // 1. 精选清单去重
  const titles = new Set<string>(SEED_TITLES);

  // 2. 搜索补全
  try {
    console.log(
      `[crawl-wikipedia] 搜索补全:"${opts.searchQuery}" (limit=${opts.searchLimit})`
    );
    const found = await searchTitles(
      opts.searchQuery,
      parseInt(opts.searchLimit, 10)
    );
    for (const t of found) titles.add(t);
  } catch (e) {
    console.warn(
      `[crawl-wikipedia] 搜索补全失败(继续用精选清单): ${e instanceof Error ? e.message : e}`
    );
  }

  const titleArr = [...titles].slice(0, maxArticles);
  console.log(`[crawl-wikipedia] 待抓取词条:${titleArr.length} 个`);

  const articles = await fetchArticles(titleArr, fetchedAt);
  console.log(`[crawl-wikipedia] 实际取回:${articles.length} 个`);

  let ok = 0;
  let empty = 0;
  for (const a of articles) {
    const slug = slugify(a.title);
    // 原始落盘
    fs.writeFileSync(
      path.join(rawDir, `${slug}.json`),
      JSON.stringify(a, null, 2),
      "utf-8"
    );
    // 渲染可浏览页
    fs.writeFileSync(path.join(outDir, `${slug}.md`), renderArticle(a), "utf-8");
    if (a.extract.length > 0) ok++;
    else empty++;
  }

  fs.writeFileSync(path.join(outDir, "INDEX.md"), renderIndex(articles), "utf-8");

  console.log(`[crawl-wikipedia] ✅ 成功 ${ok} 条(其中 ${empty} 条无正文)`);
  console.log(
    `[crawl-wikipedia]    原始落盘:${path.relative(root, rawDir)}/`
  );
  console.log(
    `[crawl-wikipedia]    可浏览页:${path.relative(root, outDir)}/  (入口: INDEX.md)`
  );
}

main().catch((e) => {
  console.error("[crawl-wikipedia] 致命错误:", e);
  process.exit(1);
});
