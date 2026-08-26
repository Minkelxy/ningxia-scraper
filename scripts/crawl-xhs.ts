#!/usr/bin/env tsx
/**
 * scripts/crawl-xhs.ts
 *
 * 用人工辅助登录导出的 cookie(web_session 等)走 www.xiaohongshu.com,
 * 抓取小红书笔记(正文+图片),渲染成 docs/xhs/<noteId>.md 可在 GitHub 直接浏览。
 * 图片下载到 images/xhs/<noteId>/ 本地引用(避开小红书图片防盗链)。
 *
 * 小红书 web API 多数需要 x-s/x-t 签名(由前端 JS 生成,脚本难以复现),
 * 因此本脚本采用「探索页 HTML 解析」方式:访问 /explore/<noteId> 取回 HTML,
 * 从内嵌的 window.__INITIAL_STATE__ JSON 中提取笔记结构化数据。
 *
 * cookie 来源:你登录 www.xiaohongshu.com 后,从浏览器 DevTools →
 * Application → Cookies → 复制整段 Cookie(至少含 web_session),存为
 * GitHub Secret XHS_COOKIE(本地可 export XHS_COOKIE='web_session=...; ...')。
 * 脚本不跑无头浏览器,只用 fetch + Cookie + 真实桌面端 UA。
 *
 * noteId 来源:你在浏览器里浏览小红书宁夏相关笔记,从 URL
 * https://www.xiaohongshu.com/explore/<noteId> 复制末段 ID,
 * 通过 --note-ids 传入或写到 data-raw/xhs/note-ids.txt(每行一个)。
 *
 * 合规:小红书用户内容版权归原作者所有,仅作内部编辑参考,页脚标注原作者
 *       与原文链接;图片下载仅用于本仓库浏览,遵循原作者授权。
 *
 * 用法:
 *   XHS_COOKIE='web_session=...' npm run crawl:xhs -- --note-ids 65a... 65b...
 *   npm run crawl:xhs -- --note-ids-file data-raw/xhs/note-ids.txt
 *   npm run crawl:xhs -- --no-images   # 只抓文本不下载图片
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 桌面 Chrome UA(小红书 web 端要求桌面 UA)
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url: string, cookie: string): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://www.xiaohongshu.com/",
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
      return await r.text();
    } catch (e) {
      lastErr = e;
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function downloadImage(url: string, dest: string): Promise<void> {
  // 小红书图片需要带 Referer 否则 403
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://www.xiaohongshu.com/" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`img HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

// 从 explore 页 HTML 中提取 window.__INITIAL_STATE__ JSON
function extractInitialState(html: string): any | null {
  // 形如: <script>window.__INITIAL_STATE__={...}</script>
  // 也可能写作 window.__INITIAL_STATE__=\u0022...\u0022
  const markers = [
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/,
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*\n/,
  ];
  for (const re of markers) {
    const m = html.match(re);
    if (m) {
      try {
        // 小红书偶尔会把 JSON 里的 " 转义成 \u0022,先还原
        const raw = (m[1] ?? "").replace(/\\u0022/g, '"');
        return JSON.parse(raw);
      } catch {
        // 继续尝试下一个 marker
      }
    }
  }
  // 退化:尝试截取首个 { 到对应 } 的最大块(JSON.parse 自带校验)
  const start = html.indexOf("window.__INITIAL_STATE__");
  if (start === -1) return null;
  const braceStart = html.indexOf("{", start);
  if (braceStart === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = braceStart; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const snippet = html.slice(braceStart, i + 1).replace(/\\u0022/g, '"');
        try {
          return JSON.parse(snippet);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

type XhsNote = {
  noteId: string;
  title: string;
  desc: string;
  author: string;
  authorId: string;
  type: "normal" | "video" | string;
  createdAt: string;
  likedCount: string;
  collectedCount: string;
  commentCount: string;
  shareCount: string;
  tagList: string[];
  picUrls: string[]; // 原图 URL
  fetchedAt: string;
};

function stripHtml(s: string): string {
  return (s ?? "")
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

async function fetchNote(
  noteId: string,
  cookie: string,
  fetchedAt: string
): Promise<XhsNote | null> {
  const url = `https://www.xiaohongshu.com/explore/${noteId}`;
  const html = await fetchHtml(url, cookie);
  const state = extractInitialState(html);
  if (!state) return null;

  // 数据结构: state.note.noteDetailMap[noteId].note
  const detailMap: any = state?.note?.noteDetailMap ?? state?.note?.firstNoteMap ?? {};
  const entry = detailMap[noteId] ?? detailMap[noteId.toLowerCase()] ?? Object.values(detailMap)[0];
  const note: any = entry?.note ?? entry;
  if (!note || !note.noteId) return null;

  const picUrls: string[] = [];
  const imageList: any[] = note?.imageList ?? [];
  for (const img of imageList) {
    // 优先 original → urlDefault → url
    const u = img?.urlDefault ?? img?.url ?? img?.infoList?.[0]?.url;
    if (u) picUrls.push(u);
  }

  return {
    noteId: String(note.noteId),
    title: stripHtml(note.title ?? ""),
    desc: stripHtml(note.desc ?? ""),
    author: note?.user?.nickname ?? note?.user?.nickName ?? "",
    authorId: String(note?.user?.userId ?? ""),
    type: note?.type ?? "normal",
    createdAt: note?.time ?? note?.createTime ?? "",
    likedCount: String(note?.interactInfo?.likedCount ?? "0"),
    collectedCount: String(note?.interactInfo?.collectedCount ?? "0"),
    commentCount: String(note?.interactInfo?.commentCount ?? "0"),
    shareCount: String(note?.interactInfo?.shareCount ?? "0"),
    tagList: Array.isArray(note?.tagList) ? note.tagList.map((t: any) => t?.name ?? "").filter(Boolean) : [],
    picUrls,
    fetchedAt,
  };
}

function slugNote(noteId: string): string {
  return `xhs-${noteId}`;
}

function relImagePath(noteId: string, idx: number, ext: string): string {
  // docs/xhs/<noteId>.md → ../../images/xhs/<noteId>/pic-<n>.<ext>
  return `../../images/xhs/${slugNote(noteId)}/pic-${idx}.${ext}`;
}

function extFromUrl(url: string): string {
  const m = url.match(/\.(jpg|jpeg|png|webp|gif)(?:\?|#|$)/i);
  return m ? (m[1] ?? "").toLowerCase().replace("jpeg", "jpg") : "jpg";
}

function renderNote(p: XhsNote, imgPaths: string[]): string {
  const lines: string[] = [];
  const title = (p.title || p.desc || "").slice(0, 40).replace(/\n/g, " ") || "(无标题)";
  lines.push(`# ${title}${(p.title || p.desc).length > 40 ? "…" : ""}`);
  lines.push("");
  lines.push(
    "> ⚠️ **版权声明**:本页内容来自小红书公开笔记,版权归原作者所有。仅作内部编辑参考,不得直接转载商用。原作者下架请走 [takedown Issue](../../.github/ISSUE_TEMPLATE/takedown-request.yml)。"
  );
  lines.push("");
  lines.push("| 字段 | 值 |");
  lines.push("|------|-----|");
  lines.push(`| noteId | \`${p.noteId}\` |`);
  lines.push(`| 作者 | ${p.author} |`);
  if (p.authorId) lines.push(`| 作者 ID | \`${p.authorId}\` |`);
  lines.push(`| 笔记类型 | ${p.type === "video" ? "视频" : "图文"} |`);
  if (p.createdAt) lines.push(`| 发布时间 | ${p.createdAt} |`);
  lines.push(`| ❤️ 点赞 | ${p.likedCount} |`);
  lines.push(`| ⭐ 收藏 | ${p.collectedCount} |`);
  lines.push(`| 💬 评论 | ${p.commentCount} |`);
  lines.push(`| 🔗 分享 | ${p.shareCount} |`);
  lines.push(`| 抓取日期(UTC) | ${p.fetchedAt} |`);
  lines.push(
    `| 原文链接 | [https://www.xiaohongshu.com/explore/${p.noteId}](https://www.xiaohongshu.com/explore/${p.noteId}) |`
  );
  if (p.tagList.length > 0) {
    lines.push(`| 标签 | ${p.tagList.map((t) => `\`#${t}\``).join(" ")} |`);
  }
  lines.push("");

  if (p.desc.trim()) {
    lines.push("## 正文");
    lines.push("");
    lines.push(p.desc.trim());
    lines.push("");
  }

  if (imgPaths.length > 0) {
    lines.push("## 图片");
    lines.push("");
    imgPaths.forEach((rel, i) => {
      lines.push(`![${p.noteId}-img-${i + 1}](${rel})`);
      lines.push("");
    });
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `← [返回全量目录](./INDEX.md) · [返回总览](../BROWSE.md) · [在小红书查看原文](https://www.xiaohongshu.com/explore/${p.noteId})`
  );
  lines.push("");
  return lines.join("\n");
}

function renderIndex(notes: XhsNote[]): string {
  const lines: string[] = [];
  lines.push("# 📚 小红书 · 宁夏相关笔记目录");
  lines.push("");
  lines.push(
    `> 来源:[www.xiaohongshu.com](https://www.xiaohongshu.com) · 共 ${notes.length} 篇 · 抓取于 ${notes[0]?.fetchedAt ?? new Date().toISOString().slice(0, 19)} UTC · 仅供内部参考`
  );
  lines.push("");
  lines.push("所有页面已镜像到本仓库,可在 GitHub 上直接浏览。图片下载到本地引用。");
  lines.push("");
  lines.push("| # | 作者 | 标题预览 | ❤️ | ⭐ | 💬 | 发布 | 链接 |");
  lines.push("|---|------|----------|----|----|----|------|------|");
  const sorted = [...notes].sort(
    (a, b) => parseInt(b.likedCount.replace(/[^\d]/g, "") || "0") - parseInt(a.likedCount.replace(/[^\d]/g, "") || "0")
  );
  sorted.forEach((p, i) => {
    const prev = (p.title || p.desc || "").slice(0, 30).replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(
      `| ${i + 1} | ${p.author} | ${prev || "(无标题)"} | ${p.likedCount} | ${p.collectedCount} | ${p.commentCount} | ${p.createdAt} | [查看](./${slugNote(p.noteId)}.md) |`
    );
  });
  lines.push("");
  lines.push("← [返回总览](../BROWSE.md)");
  lines.push("");
  return lines.join("\n");
}

function readNoteIdsFile(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

async function main() {
  const program = new Command();
  program
    .name("crawl-xhs")
    .description("用 cookie 走 www.xiaohongshu.com 抓取笔记,镜像到 docs/xhs/")
    .option("--note-ids <ids...>", "笔记 ID 列表(从 explore URL 末段取)")
    .option("--note-ids-file <path>", "笔记 ID 文件(每行一个,# 开头注释)")
    .option("--root <dir>", "本仓库根", ROOT)
    .option("--out-dir <dir>", "渲染输出目录", "docs/xhs")
    .option("--raw-dir <dir>", "原始落盘目录", "data-raw/xhs")
    .option("--img-dir <dir>", "图片下载目录", "images/xhs")
    .option("--no-images", "只抓文本不下载图片")
    .parse(process.argv);

  const opts = program.opts();
  const root = path.resolve(opts.root);
  const outDir = path.resolve(root, opts.outDir);
  const rawDir = path.resolve(root, opts.rawDir);
  const imgDir = path.resolve(root, opts.imgDir);

  // cookie 来源优先级:本地 Playwright 登录产物 > 环境变量(CI Secret / export)
  const cookieFile = path.resolve(root, "config/secrets/xhs-cookie.txt");
  let cookie = process.env.XHS_COOKIE ?? "";
  if (!cookie && fs.existsSync(cookieFile)) {
    cookie = fs.readFileSync(cookieFile, "utf-8").trim();
    console.log(`[crawl-xhs] 已读取本地 cookie:${path.relative(root, cookieFile)}`);
  }
  if (!cookie) {
    console.error(
      "[crawl-xhs] ❌ 未找到 cookie。两种方式任选其一:\n" +
        "  1) 本地: npm run login:xhs   (Playwright 弹出浏览器,登录后自动存盘到 config/secrets/xhs-cookie.txt)\n" +
        "  2) CI/环境: 登录 www.xiaohongshu.com 导出 Cookie,设为 GitHub Secret XHS_COOKIE 或 export XHS_COOKIE=..."
    );
    process.exit(2);
  }

  // 合并 noteId 来源:CLI 参数 + 文件
  const ids = new Set<string>(opts.noteIds ?? []);
  if (opts.noteIdsFile) {
    for (const id of readNoteIdsFile(path.resolve(root, opts.noteIdsFile))) ids.add(id);
  }

  if (ids.size === 0) {
    console.error(
      "[crawl-xhs] ❌ 没有提供 noteId。请用 --note-ids <id...> 或 --note-ids-file <path> 传入(从 https://www.xiaohongshu.com/explore/<id> URL 末段取)。"
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
  const noteIds = [...ids];
  console.log(`[crawl-xhs] 待抓取笔记:${noteIds.length} 个`);

  const notes: XhsNote[] = [];
  for (const id of noteIds) {
    try {
      const n = await fetchNote(id, cookie, fetchedAt);
      if (n) notes.push(n);
      else console.warn(`[crawl-xhs] noteId ${id}: 未解析到笔记数据(可能 cookie 失效或笔记已删)`);
    } catch (e) {
      console.warn(`[crawl-xhs] 抓取 noteId ${id} 失败: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(400); // 礼貌限速,小红书反爬较严
  }
  console.log(`[crawl-xhs] 实际取回:${notes.length} 篇`);

  let ok = 0;
  let imgOk = 0;
  let imgFail = 0;
  for (const p of notes) {
    const slug = slugNote(p.noteId);
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
        const ext = extFromUrl(picUrl);
        const dest = path.join(imgDir, slug, `pic-${i + 1}.${ext}`);
        try {
          await downloadImage(picUrl, dest);
          imgPaths.push(relImagePath(p.noteId, i + 1, ext));
          imgOk++;
        } catch (e) {
          imgFail++;
          // 下载失败就用热链兜底(小红书热链大概率 403,仅作占位)
          imgPaths.push(picUrl);
        }
      }
    } else if (p.picUrls.length > 0) {
      // --no-images:直接热链
      imgPaths.push(...p.picUrls);
    }

    fs.writeFileSync(path.join(outDir, `${slug}.md`), renderNote(p, imgPaths), "utf-8");
    ok++;
  }

  fs.writeFileSync(path.join(outDir, "INDEX.md"), renderIndex(notes), "utf-8");

  console.log(`[crawl-xhs] ✅ 成功 ${ok} 篇,图片下载 ${imgOk} 成功 / ${imgFail} 失败`);
  console.log(`[crawl-xhs]    原始落盘:${path.relative(root, rawDir)}/`);
  console.log(`[crawl-xhs]    可浏览页:${path.relative(root, outDir)}/  (入口: INDEX.md)`);
}

main().catch((e) => {
  console.error("[crawl-xhs] 致命错误:", e);
  process.exit(1);
});
