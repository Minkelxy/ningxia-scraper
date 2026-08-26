#!/usr/bin/env tsx
/**
 * scripts/crawl-github-journal.ts
 *
 * 真爬真实网站(github.com/Minkelxy/ningxia-tourism 姊妹仓库)的宁夏旅游 journal 内容,
 * 落到本仓库 data-raw/crawled/,并渲染成 docs/crawled/<slug>.md 可在 GitHub 直接浏览。
 *
 * 数据来源(都通过 gh CLI 调 GitHub Contents API 抓取,无需任何 cookie/登录态):
 *   - src/content/journal/*.md          19 篇真实宁夏旅游 journal
 *   - README.md                        主项目说明
 *   - XHS-SCRAPER-REFERENCE.md         素材库对接手册
 *   - docs/content/CONTENT_AUDIT.md    内容审计
 *   - docs/content/MAINTENANCE.md      编辑维护
 *   - docs/content/IMAGE_PROVENANCE.md 图片来源
 *
 * 合规:GitHub 公开仓库的公开内容,直接抓取并保留原作者署名;只是把已有的真实内容
 *      镜像到本素材库便于浏览,不修改原文。
 *
 * 用法:
 *   npm run crawl:github
 *   npm run crawl:github -- --source-repo Minkelxy/ningxia-tourism
 *   npm run crawl:github -- --paths src/content/journal README.md docs/content
 */
import { Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

type GhContentEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  sha: string;
  html_url: string;
  download_url: string | null;
};

type GhFileContent = GhContentEntry & {
  content?: string; // base64
  encoding?: "base64" | "utf-8" | null;
};

function ghApi<T = unknown>(endpoint: string): T {
  // gh api 已通过 GH_TOKEN 认证;CI 里用内置 GITHUB_TOKEN 也可
  const out = execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", endpoint], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf-8",
  });
  return JSON.parse(out) as T;
}

function decodeBase64(s: string): string {
  // GitHub Contents API 返回的 base64 可能含换行,需先清理
  const clean = s.replace(/\s+/g, "");
  return Buffer.from(clean, "base64").toString("utf-8");
}

function slugify(p: string): string {
  // src/content/journal/foo-bar.md -> journal-foo-bar
  // README.md -> README
  // docs/content/CONTENT_AUDIT.md -> content-CONTENT_AUDIT
  const base = p.replace(/\.md$/i, "").replace(/\//g, "-");
  return base;
}

function escapeShellPath(s: string): string {
  // 简单 URL path 段编码,用于 gh api endpoint
  return s
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

async function listFilesRecursive(repo: string, p: string): Promise<GhContentEntry[]> {
  const endpoint = `repos/${repo}/contents/${escapeShellPath(p)}`;
  const data = ghApi<GhContentEntry[] | GhFileContent>(endpoint);
  if (!Array.isArray(data)) {
    // 单文件 endpoint
    return [data];
  }
  const out: GhContentEntry[] = [];
  for (const entry of data) {
    if (entry.type === "file") {
      out.push(entry);
    } else if (entry.type === "dir") {
      // 递归
      out.push(...(await listFilesRecursive(repo, entry.path)));
    }
  }
  return out;
}

function fetchFileContent(repo: string, p: string): { content: string; sha: string; html_url: string } {
  const data = ghApi<GhFileContent>(`repos/${repo}/contents/${escapeShellPath(p)}`);
  if (typeof data.content !== "string" || data.encoding !== "base64") {
    throw new Error(`${p} 不是 base64 编码的文件 (encoding=${data.encoding})`);
  }
  return { content: decodeBase64(data.content), sha: data.sha, html_url: data.html_url };
}

type CrawledDoc = {
  sourcePath: string; // 在源仓库的路径
  slug: string;
  rawContent: string;
  sha: string;
  htmlUrl: string;
  size: number;
};

function extractTitle(doc: CrawledDoc): string {
  // 1. 优先 frontmatter 的 title 字段
  const fm = doc.rawContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    const t = fm[1].match(/^title:\s*(.+?)\s*$/m);
    if (t) return t[1].replace(/^["']|["']$/g, "").trim();
  }
  // 2. 第一个 # 标题
  const h1 = doc.rawContent.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  // 3. slug 兜底
  return doc.slug;
}

function renderBrowsablePage(doc: CrawledDoc, repo: string, fetchedAt: string): string {
  const lines: string[] = [];
  const title = extractTitle(doc);
  lines.push(`# ${title}`);
  lines.push("");
  lines.push("> ℹ️ **来源说明**:本页内容由 [`crawl-github-journal.ts`](../../scripts/crawl-github-journal.ts) 从姊妹仓库 [Minkelxy/ningxia-tourism](https://github.com/Minkelxy/ningxia-tourism) 真实抓取并镜像,版权归原作者所有。原文可在 GitHub 直接访问。");
  lines.push("");
  lines.push("| 字段 | 值 |");
  lines.push("|------|-----|");
  lines.push(`| 源仓库 | [${repo}](https://github.com/${repo}) |`);
  lines.push(`| 源路径 | [\`${doc.sourcePath}\`](${doc.htmlUrl}) |`);
  lines.push(`| 抓取日期(UTC) | ${fetchedAt} |`);
  lines.push(`| 文件大小 | ${doc.size} bytes |`);
  lines.push(`| 源 commit sha | \`${doc.sha.slice(0, 12)}\` |`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 原文内容");
  lines.push("");
  // 原文已经是 Markdown,直接拼接(去掉原文里第一行标题避免重复)
  const body = doc.rawContent.replace(/^#\s+.+\r?\n/, "");
  lines.push(body.trim());
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("← [返回全量目录](./INDEX.md) · [返回总览](../BROWSE.md) · [在源仓库查看原文]({{SOURCE_URL}})".replace("{{SOURCE_URL}}", doc.htmlUrl));
  lines.push("");
  return lines.join("\n");
}

function renderIndex(docs: CrawledDoc[], repo: string, fetchedAt: string): string {
  const lines: string[] = [];
  lines.push("# 📚 真实网站爬取内容目录");
  lines.push("");
  lines.push(`> 来源:[${repo}](https://github.com/${repo}) · 共 ${docs.length} 篇 · 抓取于 ${fetchedAt} UTC`);
  lines.push("");
  lines.push("所有页面已镜像到本仓库,无需访问外网即可在 GitHub 上直接浏览。");
  lines.push("");
  lines.push("| # | slug | 标题 | 源路径 | 大小 | 浏览 |");
  lines.push("|---|------|------|--------|------|------|");
  docs.forEach((d, i) => {
    const title = extractTitle(d).replace(/\|/g, "\\|");
    lines.push(`| ${i + 1} | \`${d.slug}\` | ${title} | \`${d.sourcePath}\` | ${d.size}B | [查看](./${d.slug}.md) |`);
  });
  lines.push("");
  lines.push("← [返回总览](../BROWSE.md)");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const program = new Command();
  program
    .name("crawl-github-journal")
    .description("从 Minkelxy/ningxia-tourism 真爬真实 Markdown 内容,镜像到 docs/crawled/")
    .option("--source-repo <repo>", "源 GitHub 仓库 (owner/repo)", "Minkelxy/ningxia-tourism")
    .option("--paths <paths...>", "要抓取的路径(目录会递归)", ["src/content/journal", "README.md", "XHS-SCRAPER-REFERENCE.md", "docs/content"])
    .option("--root <dir>", "本仓库根", ROOT)
    .option("--out-dir <dir>", "渲染输出目录", "docs/crawled")
    .option("--raw-dir <dir>", "原始落盘目录", "data-raw/crawled")
    .option("--max-files <n>", "单次最多抓取文件数(防止失控)", "100")
    .parse(process.argv);

  const opts = program.opts();
  const root = path.resolve(opts.root);
  const outDir = path.resolve(root, opts.outDir);
  const rawDir = path.resolve(root, opts.rawDir);
  const maxFiles = parseInt(opts.maxFiles, 10);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const fetchedAt = new Date().toISOString().slice(0, 19);
  console.log(`[crawl-github] 源仓库:${opts.sourceRepo}`);
  console.log(`[crawl-github] 抓取路径:${opts.paths.join(", ")}`);

  const allEntries: GhContentEntry[] = [];
  for (const p of opts.paths) {
    try {
      const entries = await listFilesRecursive(opts.sourceRepo, p);
      allEntries.push(...entries);
    } catch (e) {
      console.warn(`[crawl-github] 跳过 ${p}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 只保留 .md 文件
  const mdEntries = allEntries.filter((e) => e.type === "file" && /\.md$/i.test(e.name));
  if (mdEntries.length > maxFiles) {
    console.warn(`[crawl-github] 文件数 ${mdEntries.length} 超过上限 ${maxFiles},截断`);
    mdEntries.length = maxFiles;
  }

  console.log(`[crawl-github] 待抓取 Markdown 文件:${mdEntries.length} 个`);

  const docs: CrawledDoc[] = [];
  let okCount = 0;
  let failCount = 0;
  for (const entry of mdEntries) {
    try {
      const { content, sha, html_url } = fetchFileContent(opts.sourceRepo, entry.path);
      const slug = slugify(entry.path);
      const doc: CrawledDoc = {
        sourcePath: entry.path,
        slug,
        rawContent: content,
        sha,
        htmlUrl: html_url,
        size: entry.size,
      };
      docs.push(doc);
      // 原始落盘
      fs.writeFileSync(path.join(rawDir, `${slug}.md`), content, "utf-8");
      // 渲染可浏览页
      fs.writeFileSync(path.join(outDir, `${slug}.md`), renderBrowsablePage(doc, opts.sourceRepo, fetchedAt), "utf-8");
      okCount++;
    } catch (e) {
      console.warn(`[crawl-github] 抓取 ${entry.path} 失败: ${e instanceof Error ? e.message : e}`);
      failCount++;
    }
  }

  // 生成 INDEX
  fs.writeFileSync(path.join(outDir, "INDEX.md"), renderIndex(docs, opts.sourceRepo, fetchedAt), "utf-8");

  console.log(`[crawl-github] ✅ 成功 ${okCount} 篇,失败 ${failCount} 篇`);
  console.log(`[crawl-github]    原始落盘:${path.relative(root, rawDir)}/`);
  console.log(`[crawl-github]    可浏览页:${path.relative(root, outDir)}/  (入口: INDEX.md)`);
}

main().catch((e) => {
  console.error("[crawl-github] 致命错误:", e);
  process.exit(1);
});
