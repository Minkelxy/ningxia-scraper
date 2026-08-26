#!/usr/bin/env tsx
/**
 * scripts/publish-notes.ts
 *
 * 把 data/notes.ndjson 里的所有笔记(含图片)渲染成可在 GitHub 直接浏览的 Markdown 页面:
 *   docs/notes/<noteId>.md          每条笔记一页(正文 + 图片 + 元数据 + 来源链接)
 *   docs/notes/INDEX.md             全量目录表(按点赞/收藏/发布日期可排序)
 *
 * 设计目标:让用户在 GitHub 网页上直接浏览爬到的内容,无需 clone 或跑脚本。
 *
 * 用法:
 *   npm run publish:notes
 *   npm run publish:notes -- --out-dir docs/notes
 *   npm run publish:notes -- --include-removed   # 也输出已下架的(默认跳过)
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readNdjson, DEFAULT_ROOT } from "../src/lib/storage.js";
import type { XhsNote } from "../src/schema/note.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function esc(s: string | null | undefined): string {
  if (!s) return "";
  // 转义会破坏 Markdown 渲染的字符,但保留可读性
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function relImagePath(localPath: string): string {
  // localPath 形如 /images/full/<id>/img-001.webp
  // 从 docs/notes/<id>.md 出发 → ../../images/full/<id>/img-001.webp
  const clean = localPath.replace(/^\/+/, "");
  return `../../${clean}`;
}

function noteFileContent(n: XhsNote): string {
  const lines: string[] = [];
  lines.push(`# ${n.title ? esc(n.title) : "(无标题)"}`);
  lines.push("");
  lines.push("> ⚠️ **版权声明**:本页内容来自小红书公开笔记,版权归原作者所有。仅作内部编辑参考,不得直接转载商用。原作者下架请走 [takedown Issue](../../.github/ISSUE_TEMPLATE/takedown-request.yml)。");
  lines.push("");

  // 元数据表
  lines.push("| 字段 | 值 |");
  lines.push("|------|-----|");
  lines.push(`| noteId | \`${n.noteId}\` |`);
  lines.push(`| 作者 | ${esc(n.authorNickname)} |`);
  lines.push(`| 发布日期 | ${n.publishedAt ?? "-"} |`);
  lines.push(`| 抓取日期 | ${n.fetchedAt} |`);
  lines.push(`| 城市 | ${esc(n.geoHint.cityName) || "-"} |`);
  lines.push(`| 景点 | ${esc(n.geoHint.attractionName) || "-"} |`);
  lines.push(`| 话题 | ${n.topics.length ? n.topics.map(esc).join(", ") : "-"} |`);
  lines.push(`| 👍 点赞 | ${n.likeCount ?? "-"} |`);
  lines.push(`| ⭐ 收藏 | ${n.collectCount ?? "-"} |`);
  lines.push(`| 💬 评论 | ${n.commentCount ?? "-"} |`);
  lines.push(`| 采集质量 | ${n.ingestQuality} |`);
  lines.push(`| 来源 | [小红书原笔记](${n.sourceUrl}) |`);
  lines.push("");

  // 正文
  if (n.bodyPlainText && n.bodyPlainText.trim()) {
    lines.push("## 正文");
    lines.push("");
    lines.push(n.bodyPlainText.trim());
    lines.push("");
  } else if (n.bodyHtml) {
    lines.push("## 正文");
    lines.push("");
    lines.push("<details><summary>正文 HTML(展开查看)</summary>");
    lines.push("");
    lines.push(n.bodyHtml);
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // 图片
  if (n.images.length > 0) {
    lines.push("## 图片");
    lines.push("");
    n.images.forEach((img, i) => {
      const rel = relImagePath(img.localPath);
      const cap = img.captionFromNote ? ` *${esc(img.captionFromNote)}*` : "";
      const dim = img.width && img.height ? ` (${img.width}×${img.height})` : "";
      lines.push(`### 图 ${i + 1}${dim}`);
      lines.push("");
      lines.push(`![${n.noteId}-img-${i + 1}](${rel})`);
      lines.push("");
      if (cap) {
        lines.push(cap);
        lines.push("");
      }
      lines.push(`<sub>sha256: <code>${img.sha256}</code> · license: ${img.license}</sub>`);
      lines.push("");
    });
  }

  // 底部导航
  lines.push("---");
  lines.push("");
  lines.push("← [返回总览](../BROWSE.md) · [全量目录](./INDEX.md)");
  lines.push("");

  return lines.join("\n");
}

function indexFileContent(notes: XhsNote[]): string {
  const lines: string[] = [];
  lines.push("# 📚 全量笔记目录");
  lines.push("");
  lines.push(`> 共 ${notes.length} 条 · 由 \`scripts/publish-notes.ts\` 自动生成 · 最后更新 ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`);
  lines.push("");
  lines.push("可点击列头排序(在 GitHub 上点击表头即可)。");
  lines.push("");
  lines.push("| # | noteId | 标题 | 作者 | 城市 | 话题 | 👍 | ⭐ | 💬 | 发布 | 链接 |");
  lines.push("|---|--------|------|------|------|------|----|----|----|------|------|");
  // 默认按点赞降序
  const sorted = [...notes].sort(
    (a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0)
  );
  sorted.forEach((n, i) => {
    lines.push(
      `| ${i + 1} | \`${n.noteId}\` | ${esc(n.title) || "(无标题)"} | ${esc(n.authorNickname)} | ${esc(n.geoHint.cityName) || "-"} | ${n.topics.map(esc).join(", ") || "-"} | ${n.likeCount ?? "-"} | ${n.collectCount ?? "-"} | ${n.commentCount ?? "-"} | ${n.publishedAt ?? "-"} | [查看](./${n.noteId}.md) |`
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
    .name("publish-notes")
    .description("把 notes.ndjson 渲染成 GitHub 可浏览的 docs/notes/*.md")
    .option("--out-dir <dir>", "输出目录", "docs/notes")
    .option("--root <dir>", "项目根", ROOT)
    .option("--include-removed", "包含已下架的笔记(默认跳过)", false)
    .parse(process.argv);

  const opts = program.opts();
  const root = path.resolve(opts.root);
  const outDir = path.resolve(root, opts.outDir);

  fs.mkdirSync(outDir, { recursive: true });

  const map = readNdjson(root);
  if (map.size === 0) {
    console.error(`[publish-notes] data/notes.ndjson 为空或不存在(root=${root})`);
    process.exit(1);
  }

  let published = 0;
  let skipped = 0;
  const all: XhsNote[] = [];
  for (const { note } of map.values()) {
    if (!note) {
      skipped++;
      continue;
    }
    if (!opts.includeRemoved && note.removeRequested !== false) {
      skipped++;
      continue;
    }
    all.push(note);
    const md = noteFileContent(note);
    fs.writeFileSync(path.join(outDir, `${note.noteId}.md`), md, "utf8");
    published++;
  }

  fs.writeFileSync(path.join(outDir, "INDEX.md"), indexFileContent(all), "utf8");

  console.log(
    `[publish-notes] ✅ 已生成 ${published} 条笔记页面 → ${path.relative(root, outDir)}/  (跳过 ${skipped} 条)`
  );
  console.log(`[publish-notes]    目录:${path.join(outDir, "INDEX.md")}`);
}

main().catch((e) => {
  console.error("[publish-notes] 失败:", e);
  process.exit(1);
});
