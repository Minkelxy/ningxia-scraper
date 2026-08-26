#!/usr/bin/env tsx
/**
 * scripts/crawl-weibo.ts
 *
 * 用人工辅助登录导出的 cookie(SUB/SUBP 等)走 m.weibo.cn JSON 接口,
 * 按关键词搜宁夏旅游相关微博,抓正文+图片,渲染成 docs/weibo/<mid>.md
 * 可在 GitHub 直接浏览。图片下载到 images/weibo/<mid>/ 本地引用
 * (避开 sinaimg 的 Referer 403,在 GitHub 上能正常显示)。
 *
 * cookie 来源:你登录 m.weibo.cn 后,从浏览器 DevTools → Network → 任意请求 →
 * Request Headers → 复制 Cookie 整段,存为 GitHub Secret WEIBO_COOKIE
 * (本地可 export WEIBO_COOKIE='SUB=...; SUBP=...')。
 * 脚本不跑无头浏览器,只用 fetch + Cookie + 真实移动端 UA。
 *
 * 合规:微博用户内容版权归原作者所有,仅作内部编辑参考,页脚标注原作者与原文链接;
 *       图片下载仅用于本仓库浏览,遵循原作者授权。
 *
 * 用法:
 *   WEIBO_COOKIE='SUB=...; SUBP=...' npm run crawl:weibo
 *   npm run crawl:weibo -- --keywords 宁夏旅游 沙坡头 --max-posts 60
 *   npm run crawl:weibo -- --no-images   # 只抓文本不下载图片
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 移动端 Safari UA + 标注爬虫身份
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1 MinkelxyCrawler/1.0";

// 宁夏旅游关键词清单
const DEFAULT_KEYWORDS = [
  "宁夏旅游",
  "沙坡头",
  "西夏王陵",
  "贺兰山",
  "银川旅游",
  "中卫旅游",
  "沙湖",
  "六盘山",
  "镇北堡",
  "水洞沟",
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function wbJson(url: string, cookie: string): Promise<any> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "MWeibo-Pwa": "1",
    "Referer": "https://m.weibo.cn/",
    "Accept": "application/json, text/plain, */*",
  };
  if (cookie) headers["Cookie"] = cookie;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (r.status === 429 || r.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} on ${url.slice(0, 80)}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function downloadImage(url: string, dest: string): Promise<void> {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://m.weibo.cn/" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`img HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

// m.weibo.cn 关键词搜索:containerid=100103type=1&q=<kw>
async function searchKeyword(keyword: string, cookie: string, page = 1): Promise<string[]> {
  const cid = `100103type%3D1%26q%3D${encodeURIComponent(keyword)}`;
  const url = `https://m.weibo.cn/api/container/getIndex?containerid=${cid}&page=${page}`;
  const j = await wbJson(url, cookie);
  const cards: any[] = j?.data?.cards ?? [];
  const mids: string[] = [];
  const collect = (card: any) => {
    if (card?.card_type === 9 && card.mblog?.id) mids.push(String(card.mblog.id));
    if (Array.isArray(card?.card_group)) for (const g of card.card_group) collect(g);
  };
  for (const c of cards) collect(c);
  return mids;
}

type WeiboPost = {
  mid: string;
  text: string; // 短文本(HTML 已剥离)
  longText: string | null; // 长文本(isLongText 时)
  author: string;
  authorId: string;
  createdAt: string;
  source: string;
  reposts: number;
  comments: number;
  attitudes: number;
  geo: string | null;
  picUrls: string[]; // large 尺寸图片
  fetchedAt: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function fetchStatus(
  mid: string,
  cookie: string,
  fetchedAt: string
): Promise<WeiboPost | null> {
  const url = `https://m.weibo.cn/statuses/show?id=${mid}`;
  const j = await wbJson(url, cookie);
  const m = j?.data;
  if (!m || !m.id) return null;
  const pics: string[] = (m.pics ?? [])
    .map((p: any) => p?.large?.url ?? p?.url)
    .filter(Boolean);
  return {
    mid: String(m.id),
    text: stripHtml(m.text ?? ""),
    longText:
      m.isLongText && m.longTextContent ? stripHtml(m.longTextContent) : null,
    author: m.user?.screen_name ?? "",
    authorId: String(m.user?.id ?? ""),
    createdAt: m.created_at ?? "",
    source: stripHtml(m.source ?? "") || "",
    reposts: m.reposts_count ?? 0,
    comments: m.comments_count ?? 0,
    attitudes: m.attitudes_count ?? 0,
    geo: typeof m.geo === "string" ? m.geo.replace(/^\[|\]$/g, "").trim() : null,
    picUrls: pics,
    fetchedAt,
  };
}

function slugMid(mid: string): string {
  return `weibo-${mid}`;
}

function relImagePath(mid: string, idx: number): string {
  // docs/weibo/<mid>.md → ../../images/weibo/<mid>/pic-<n>.jpg
  return `../../images/weibo/${slugMid(mid)}/pic-${idx}.jpg`;
}

function renderPost(p: WeiboPost, imgPaths: string[]): string {
  const lines: string[] = [];
  const title = (p.longText || p.text || "").slice(0, 40).replace(/\n/g, " ") || "(无正文)";
  lines.push(`# ${title}${(p.longText || p.text).length > 40 ? "…" : ""}`);
  lines.push("");
  lines.push(
    "> ⚠️ **版权声明**:本页内容来自微博公开帖,版权归原作者所有。仅作内部编辑参考,不得直接转载商用。原作者下架请走 [takedown Issue](../../.github/ISSUE_TEMPLATE/takedown-request.yml)。"
  );
  lines.push("");
  lines.push("| 字段 | 值 |");
  lines.push("|------|-----|");
  lines.push(`| mid | \`${p.mid}\` |`);
  lines.push(`| 作者 | ${p.author} |`);
  if (p.authorId) lines.push(`| 作者 UID | \`${p.authorId}\` |`);
  lines.push(`| 发布时间 | ${p.createdAt} |`);
  if (p.source) lines.push(`| 来源(客户端) | ${p.source} |`);
  if (p.geo) lines.push(`| 地理位置 | ${p.geo} |`);
  lines.push(`| 🔁 转发 | ${p.reposts} |`);
  lines.push(`| 💬 评论 | ${p.comments} |`);
  lines.push(`| ❤️ 点赞 | ${p.attitudes} |`);
  lines.push(`| 抓取日期(UTC) | ${p.fetchedAt} |`);
  lines.push(
    `| 原文链接 | [https://m.weibo.cn/status/${p.mid}](https://m.weibo.cn/status/${p.mid}) |`
  );
  lines.push("");

  const body = p.longText || p.text;
  if (body.trim()) {
    lines.push("## 正文");
    lines.push("");
    lines.push(body.trim());
    lines.push("");
  }

  if (imgPaths.length > 0) {
    lines.push("## 图片");
    lines.push("");
    imgPaths.forEach((rel, i) => {
      lines.push(`![${p.mid}-img-${i + 1}](${rel})`);
      lines.push("");
    });
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `← [返回全量目录](./INDEX.md) · [返回总览](../BROWSE.md) · [在微博查看原文](https://m.weibo.cn/status/${p.mid})`
  );
  lines.push("");
  return lines.join("\n");
}

function renderIndex(posts: WeiboPost[]): string {
  const lines: string[] = [];
  lines.push("# 📚 微博 · 宁夏相关帖目录");
  lines.push("");
  lines.push(
    `> 来源:[m.weibo.cn](https://m.weibo.cn) · 共 ${posts.length} 条 · 抓取于 ${posts[0]?.fetchedAt ?? new Date().toISOString().slice(0, 19)} UTC · 仅供内部参考`
  );
  lines.push("");
  lines.push("所有页面已镜像到本仓库,可在 GitHub 上直接浏览。图片下载到本地引用。");
  lines.push("");
  lines.push("| # | 作者 | 正文预览 | ❤️ | 💬 | 🔁 | 发布 | 链接 |");
  lines.push("|---|------|----------|----|----|----|------|------|");
  const sorted = [...posts].sort((a, b) => b.attitudes - a.attitudes);
  sorted.forEach((p, i) => {
    const prev = (p.longText || p.text || "").slice(0, 30).replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(
      `| ${i + 1} | ${p.author} | ${prev || "(无正文)"} | ${p.attitudes} | ${p.comments} | ${p.reposts} | ${p.createdAt} | [查看](./${slugMid(p.mid)}.md) |`
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
    .name("crawl-weibo")
    .description("用 cookie 走 m.weibo.cn 抓宁夏相关微博,镜像到 docs/weibo/")
    .option("--max-posts <n>", "单次最多抓取帖数", "60")
    .option("--max-per-keyword <n>", "每个关键词最多取多少条 mid", "20")
    .option("--root <dir>", "本仓库根", ROOT)
    .option("--out-dir <dir>", "渲染输出目录", "docs/weibo")
    .option("--raw-dir <dir>", "原始落盘目录", "data-raw/weibo")
    .option("--img-dir <dir>", "图片下载目录", "images/weibo")
    .option("--keywords <kw...>", "搜索关键词", DEFAULT_KEYWORDS)
    .option("--no-images", "只抓文本不下载图片")
    .parse(process.argv);

  const opts = program.opts();
  const root = path.resolve(opts.root);
  const outDir = path.resolve(root, opts.outDir);
  const rawDir = path.resolve(root, opts.rawDir);
  const imgDir = path.resolve(root, opts.imgDir);
  const maxPosts = parseInt(opts.maxPosts, 10);
  const maxPerKw = parseInt(opts.maxPerKeyword, 10);

  // cookie 来源优先级:本地 Playwright 登录产物 > 环境变量(CI Secret / export)
  const cookieFile = path.resolve(ROOT, "config/secrets/weibo-cookie.txt");
  let cookie = process.env.WEIBO_COOKIE ?? "";
  if (!cookie && fs.existsSync(cookieFile)) {
    cookie = fs.readFileSync(cookieFile, "utf-8").trim();
    console.log(`[crawl-weibo] 已读取本地 cookie:${path.relative(ROOT, cookieFile)}`);
  }
  if (!cookie) {
    console.error(
      "[crawl-weibo] ❌ 未找到 cookie。两种方式任选其一:\n" +
        "  1) 本地: npm run login:weibo   (Playwright 弹出浏览器,登录后自动存盘到 config/secrets/weibo-cookie.txt)\n" +
        "  2) CI/环境: 登录 m.weibo.cn 导出 Cookie,设为 GitHub Secret WEIBO_COOKIE 或 export WEIBO_COOKIE=..."
    );
    process.exit(2);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });
  // 清空旧的渲染产物
  for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith(".md")) fs.unlinkSync(path.join(outDir, f));
  }

  const fetchedAt = new Date().toISOString().slice(0, 19);

  // 1. 搜索收集 mid(跨关键词去重)
  const midSet = new Set<string>();
  for (const kw of opts.keywords) {
    try {
      const mids = await searchKeyword(kw, cookie, 1);
      let added = 0;
      for (const m of mids) {
        if (!midSet.has(m)) {
          midSet.add(m);
          added++;
          if (added >= maxPerKw) break;
        }
      }
      console.log(`[crawl-weibo] 关键词 "${kw}": 搜到 ${mids.length} 条 mid,新增 ${added}`);
      if (midSet.size >= maxPosts) break;
      await sleep(200); // 礼貌限速
    } catch (e) {
      console.warn(
        `[crawl-weibo] 搜索 "${kw}" 失败: ${e instanceof Error ? e.message : e}`
      );
    }
  }

  let mids = [...midSet].slice(0, maxPosts);
  console.log(`[crawl-weibo] 待抓取帖:${mids.length} 个`);

  const posts: WeiboPost[] = [];
  for (const mid of mids) {
    try {
      const p = await fetchStatus(mid, cookie, fetchedAt);
      if (p) posts.push(p);
    } catch (e) {
      console.warn(`[crawl-weibo] 抓取 mid ${mid} 失败: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(150); // 礼貌限速
  }
  console.log(`[crawl-weibo] 实际取回:${posts.length} 条`);

  let ok = 0;
  let imgOk = 0;
  let imgFail = 0;
  for (const p of posts) {
    const slug = slugMid(p.mid);
    // 原始落盘
    fs.writeFileSync(
      path.join(rawDir, `${slug}.json`),
      JSON.stringify(p, null, 2),
      "utf-8"
    );

    // 下载图片(可选)
    const imgPaths: string[] = [];
    if (opts.images && p.picUrls.length > 0) {
      for (let i = 0; i < p.picUrls.length; i++) {
        const picUrl = p.picUrls[i] ?? "";
        const dest = path.join(imgDir, slug, `pic-${i + 1}.jpg`);
        try {
          await downloadImage(picUrl, dest);
          imgPaths.push(relImagePath(p.mid, i + 1));
          imgOk++;
        } catch (e) {
          imgFail++;
          // 下载失败就用热链兜底
          imgPaths.push(picUrl);
        }
      }
    } else if (p.picUrls.length > 0) {
      // --no-images:直接热链
      imgPaths.push(...p.picUrls);
    }

    fs.writeFileSync(path.join(outDir, `${slug}.md`), renderPost(p, imgPaths), "utf-8");
    ok++;
  }

  fs.writeFileSync(path.join(outDir, "INDEX.md"), renderIndex(posts), "utf-8");

  console.log(`[crawl-weibo] ✅ 成功 ${ok} 条,图片下载 ${imgOk} 成功 / ${imgFail} 失败`);
  console.log(`[crawl-weibo]    原始落盘:${path.relative(root, rawDir)}/`);
  console.log(`[crawl-weibo]    可浏览页:${path.relative(root, outDir)}/  (入口: INDEX.md)`);
}

main().catch((e) => {
  console.error("[crawl-weibo] 致命错误:", e);
  process.exit(1);
});
