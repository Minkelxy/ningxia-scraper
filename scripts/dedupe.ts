#!/usr/bin/env tsx
/**
 * scripts/dedupe.ts
 *
 * 三种去重检测：
 *   1. 同一 noteId 在 ndjson 中重复 → 直接更新（写回唯一一行）
 *   2. bodySimhash 海明距离 ≤ 5 的不同 noteId → 疑似同文，写 _meta.suspectedDuplicateOf
 *   3. 图片 sha256 完全一致 → 生成「共享图片引用」报告（不自动删文件，仅建议）
 *
 * 输出：dedupe-report.md，分三类列出
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readNdjson } from "../src/lib/storage.js";
import { simDistance } from "../src/lib/hashes.js";
import type { XhsNote } from "../src/schema/note.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export type DedupeFindings = {
  exactSameNoteId: Array<{ noteId: string; duplicateRows: number }>;
  suspectedDuplicates: Array<{
    noteIdA: string;
    noteIdB: string;
    hamming: number;
    titleA: string | null;
    titleB: string | null;
  }>;
  sharedImageGroups: Array<{ sha256: string; noteIds: string[]; localPaths: string[] }>;
};

export function runDedupe(root: string = ROOT, opts: {
  applySuspectedToDisk?: boolean;
} = {}): DedupeFindings & { fixedNoteIds: string[] } {
  const apply = !!opts.applySuspectedToDisk;
  const findings: DedupeFindings = {
    exactSameNoteId: [],
    suspectedDuplicates: [],
    sharedImageGroups: [],
  };

  const map = readNdjson(root);

  // 1. 同一 noteId 重复行（理论上存储层已经避免，但再次防御）
  // readNdjson 本身用 Map 所以读出来就没有重复；但我们可以查 ndjson 原始文本
  const ndjsonPath = path.join(root, "data", "notes.ndjson");
  const rawLines = fs.existsSync(ndjsonPath)
    ? fs.readFileSync(ndjsonPath, "utf8").split(/\r?\n/).filter(Boolean)
    : [];
  const counts = new Map<string, number>();
  for (const l of rawLines) {
    try {
      const { noteId } = JSON.parse(l) as { noteId: string };
      counts.set(noteId, (counts.get(noteId) ?? 0) + 1);
    } catch { /* noop */ }
  }
  for (const [noteId, dupCount] of counts.entries()) {
    if (dupCount > 1) findings.exactSameNoteId.push({ noteId, duplicateRows: dupCount });
  }
  // 如果有重复行 → 按 Map（唯一）重写 ndjson
  let fixedNoteIds: string[] = [];
  if (findings.exactSameNoteId.length > 0) {
    const uniqueLines: string[] = [];
    for (const [, { text }] of map.entries()) uniqueLines.push(text);
    fs.writeFileSync(ndjsonPath, uniqueLines.join("\n") + (uniqueLines.length ? "\n" : ""));
    fixedNoteIds = findings.exactSameNoteId.map((f) => f.noteId);
  }

  // 2. bodySimhash 疑似同文（不同 noteId）
  const notes = [...map.values()]
    .map((v) => v.note)
    .filter((n): n is XhsNote => !!n && n.removeRequested === false && !!n.bodyPlainText && n.bodyPlainText.length >= 50);

  // suspectedDupSets: 聚类（Union-Find 简单版）
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) && parent.get(x) !== x) x = parent.get(x) as string;
    return x;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  };

  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i]!;
      const b = notes[j]!;
      const dist = simDistance(a.dedupeSignatures.bodySimhash, b.dedupeSignatures.bodySimhash);
      if (dist <= 5) {
        findings.suspectedDuplicates.push({
          noteIdA: a.noteId,
          noteIdB: b.noteId,
          hamming: dist,
          titleA: a.title,
          titleB: b.title,
        });
        union(a.noteId, b.noteId);
      }
    }
  }

  // 把同一聚类写回各自的 _meta.suspectedDuplicateOf
  if (apply && findings.suspectedDuplicates.length > 0) {
    const groups = new Map<string, string[]>();
    for (const id of parent.keys()) {
      const root = find(id);
      const arr = groups.get(root) ?? [];
      if (id !== root) arr.push(id);
      groups.set(root, arr);
    }
    // 对每个 note，suspectedDuplicateOf = 组内其它 ID
    for (const [leader, others] of groups.entries()) {
      const allInGroup = [leader, ...others];
      for (const id of allInGroup) {
        const entry = map.get(id);
        if (!entry?.note) continue;
        const othersSet = allInGroup.filter((x) => x !== id);
        const note = entry.note as XhsNote & { _meta: { suspectedDuplicateOf?: string[] } };
        note._meta = { ...note._meta, suspectedDuplicateOf: othersSet };
      }
    }
    // 重写 ndjson
    const ordered: string[] = [];
    for (const [, note] of map.entries()) {
      if (note.note) ordered.push(JSON.stringify(note.note));
      else ordered.push(note.text);
    }
    fs.writeFileSync(ndjsonPath, ordered.join("\n") + "\n");
  }

  // 3. 图片 sha256 完全一致 → 共享
  const imgIndex = new Map<string, { noteId: string; localPath: string }[]>();
  for (const n of notes) {
    for (const img of n.images) {
      const arr = imgIndex.get(img.sha256) ?? [];
      arr.push({ noteId: n.noteId, localPath: img.localPath });
      imgIndex.set(img.sha256, arr);
    }
  }
  for (const [sha256, arr] of imgIndex.entries()) {
    if (arr.length >= 2) {
      findings.sharedImageGroups.push({
        sha256,
        noteIds: arr.map((a) => a.noteId),
        localPaths: arr.map((a) => a.localPath),
      });
    }
  }

  return { ...findings, fixedNoteIds };
}

export function renderMarkdownReport(r: DedupeFindings & { fixedNoteIds?: string[] }): string {
  const lines: string[] = [];
  lines.push("# Dedupe 去重报告");
  lines.push("");
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 1. 同一 noteId 重复行（精确重复）");
  if (r.exactSameNoteId.length === 0) lines.push("- 无");
  for (const f of r.exactSameNoteId) {
    lines.push(
      `- noteId=\`${f.noteId}\` 出现了 **${f.duplicateRows}** 行 → 已自动写回 1 行`
    );
  }
  if (r.fixedNoteIds && r.fixedNoteIds.length) {
    lines.push(
      `已修复写回磁盘的 noteId：${r.fixedNoteIds.map((i) => `\`${i}\``).join(", ")}`
    );
  }
  lines.push("");
  lines.push("## 2. 疑似同文（bodySimhash 海明距离 ≤ 5）");
  if (r.suspectedDuplicates.length === 0) lines.push("- 无");
  for (const f of r.suspectedDuplicates) {
    lines.push(
      `- \`${f.noteIdA}\` ↔ \`${f.noteIdB}\`  hamming=${f.hamming}  「${f.titleA ?? ""}」 vs 「${f.titleB ?? ""}」`
    );
  }
  lines.push("");
  lines.push("## 3. 图片完全一致（sha256 相同，跨笔记共享）");
  if (r.sharedImageGroups.length === 0) lines.push("- 无");
  for (const g of r.sharedImageGroups) {
    lines.push(
      `- sha256=\`${g.sha256.slice(0, 16)}…\` 出现在 ${g.noteIds.length} 条笔记：${g.noteIds.map((i) => `\`${i}\``).join(", ")}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function main(argv: string[] = process.argv): number {
  const program = new Command();
  program
    .name("dedupe")
    .description("三重去重：精确 noteId / 正文 simhash / 图片 sha256")
    .option("--report <file>", "报告输出 MD 文件路径", "dedupe-report.md")
    .option("--apply", "把 suspectedDuplicateOf 写回 ndjson（不自动删除任何文件）", false)
    .option("--root <dir>", "素材库根目录", ROOT)
    .action(() => {
      const opts = program.opts<{ report: string; apply: boolean; root: string }>();
      const r = runDedupe(opts.root, { applySuspectedToDisk: opts.apply });
      const md = renderMarkdownReport(r);
      const reportPath = path.resolve(opts.report);
      fs.writeFileSync(reportPath, md);
      console.log(md);
      console.log(`\n报告已写入: ${reportPath}`);
      // 只要没有「精确重复未修复」就不失败
      process.exit(0);
    });
  try {
    program.parse(argv, { from: "user" });
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv));
}
