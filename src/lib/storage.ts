/**
 * src/lib/storage.ts
 *
 * 数据持久化层：写 notes、生成索引、维护 provenance manifest。
 *
 * 文件契约：
 *   - data-raw/json/<noteId>.json  单条笔记完整对象
 *   - data/notes.ndjson            所有笔记，1 行 = 1 条；noteId 唯一
 *   - data/notes-index.json        noteId → 轻量摘要（便于 list-top.py）
 *   - provenance/manifest.csv      全量 provenance + 下架历史（可追加的审计日志）
 *
 * 幂等：同一 noteId 写两次 → 更新，不产生重复行。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { XhsNote } from "../schema/note.js";
import { stringify as csvStringify } from "csv-stringify/sync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

export type NoteIndexEntry = {
  noteId: string;
  title: string | null;
  authorNickname: string;
  topics: string[];
  likeCount: number | null;
  collectCount: number | null;
  commentCount: number | null;
  coverUrl: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  ingestQuality: "full" | "partial" | "images-only";
  imageCount: number;
  geoHintCity: string | null;
  geoHintAttraction: string | null;
  removed: boolean;
};

export function ensureDirs(root: string = DEFAULT_ROOT): void {
  const dirs = [
    "data-raw/html",
    "data-raw/json",
    "data-raw/pool/search-snapshots",
    "data",
    "images/full",
    "images/thumbs",
    "provenance",
    "config",
  ];
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
}

/**
 * 读取 notes.ndjson 所有行到 Map<noteId, { text, note }>。
 */
export function readNdjson(
  root: string = DEFAULT_ROOT
): Map<string, { text: string; note: XhsNote | null }> {
  const p = path.join(root, "data", "notes.ndjson");
  const m = new Map<string, { text: string; note: XhsNote | null }>();
  if (!fs.existsSync(p)) return m;
  const txt = fs.readFileSync(p, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as XhsNote;
      m.set(parsed.noteId, { text: line, note: parsed });
    } catch {
      // skip bad lines
    }
  }
  return m;
}

/** 写回 notes.ndjson */
function writeNdjson(
  linesInOrder: string[],
  root: string = DEFAULT_ROOT
): void {
  const p = path.join(root, "data", "notes.ndjson");
  fs.writeFileSync(p, linesInOrder.filter(Boolean).join("\n") + (linesInOrder.length ? "\n" : ""));
}

/** 重写 notes-index.json */
function writeIndex(all: XhsNote[], root: string = DEFAULT_ROOT): void {
  const entries: Record<string, NoteIndexEntry> = {};
  for (const n of all) {
    entries[n.noteId] = {
      noteId: n.noteId,
      title: n.title,
      authorNickname: n.authorNickname,
      topics: n.topics,
      likeCount: n.likeCount,
      collectCount: n.collectCount,
      commentCount: n.commentCount,
      coverUrl: n.images[0]?.originalUrl ?? null,
      publishedAt: n.publishedAt,
      fetchedAt: n.fetchedAt,
      ingestQuality: n.ingestQuality,
      imageCount: n.images.length,
      geoHintCity: n.geoHint.cityName ?? null,
      geoHintAttraction: n.geoHint.attractionName ?? null,
      removed: n.removeRequested !== false,
    };
  }
  fs.writeFileSync(
    path.join(root, "data", "notes-index.json"),
    JSON.stringify(entries, null, 2)
  );
}

/**
 * 追加或更新一条笔记到所有持久化文件中。
 * Returns { updated: boolean, createdDirs } for dry-run friendly reporting.
 */
export function persistNote(
  note: XhsNote,
  opts: { dryRun?: boolean; root?: string } = {}
): { filesWritten: string[] } {
  const root = opts.root ?? DEFAULT_ROOT;
  const dryRun = !!opts.dryRun;
  const filesWritten: string[] = [];

  if (!dryRun) ensureDirs(root);

  // 1. data-raw/json/<noteId>.json
  const rawJsonPath = path.join(root, "data-raw", "json", `${note.noteId}.json`);
  filesWritten.push(path.relative(root, rawJsonPath));
  if (!dryRun) fs.writeFileSync(rawJsonPath, JSON.stringify(note, null, 2));

  // 2. 更新 data/notes.ndjson
  const map = readNdjson(root);
  const existing = map.get(note.noteId);
  if (existing?.note && existing.note.sourcePlatform !== note.sourcePlatform) {
    throw new Error(
      `noteId 冲突：已存在 ${existing.note.sourcePlatform}:${note.noteId}，` +
      `无法写入 ${note.sourcePlatform}:${note.noteId}。请用 --hint-note-id 给新条目加平台前缀后重试。`
    );
  }
  map.set(note.noteId, { text: JSON.stringify(note), note });
  const orderedLines: string[] = [];
  const allNotes: XhsNote[] = [];
  // 按 fetchedAt desc + noteId asc 稳定排序
  const orderedEntries = [...map.entries()].sort((a, b) => {
    const na = a[1].note;
    const nb = b[1].note;
    const fa = na?.fetchedAt ?? "";
    const fb = nb?.fetchedAt ?? "";
    if (fa !== fb) return fb.localeCompare(fa);
    return a[0].localeCompare(b[0]);
  });
  for (const [, { text, note: n }] of orderedEntries) {
    orderedLines.push(text);
    if (n) allNotes.push(n);
  }
  filesWritten.push("data/notes.ndjson");
  if (!dryRun) writeNdjson(orderedLines, root);

  // 3. 重写 notes-index.json
  filesWritten.push("data/notes-index.json");
  if (!dryRun) writeIndex(allNotes, root);

  // 4. 追加 provenance manifest.csv
  const csvPath = path.join(root, "provenance", "manifest.csv");
  const header =
    "noteId,status,sourceUrl,authorNickname,fetchedAt,imageCount,license,reason,requester,timestamp\n";
  if (!dryRun) {
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, header);
    }
    const row = csvStringify(
      [
        [
          note.noteId,
          "ACTIVE",
          note.sourceUrl,
          note.authorNickname,
          note.fetchedAt,
          note.images.length,
          note.images[0]?.license ?? "for-reference-only",
          "",
          "",
          new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        ],
      ],
      { quoted: true, quoted_empty: true }
    ).trimEnd();
    fs.appendFileSync(csvPath, row + "\n");
  }
  filesWritten.push("provenance/manifest.csv");

  return { filesWritten };
}

/** 把 Buffer 写入 images/full/<noteId>/img-XXX.<ext>，返回相对路径和大小 */
export function saveImageFile(params: {
  root?: string;
  noteId: string;
  index: number; // 0-based
  ext: "webp" | "png" | "jpeg";
  buffer: Uint8Array;
  dryRun?: boolean;
}): { localPath: string; absPath: string; sizeBytes: number } {
  const root = params.root ?? DEFAULT_ROOT;
  const ext = params.ext === "jpeg" ? "jpg" : params.ext;
  const name = `img-${String(params.index + 1).padStart(3, "0")}.${ext}`;
  const relDir = path.join("images", "full", params.noteId);
  const relPath = path.join(relDir, name);
  const absDir = path.join(root, relDir);
  const absPath = path.join(root, relPath);
  if (!params.dryRun) {
    fs.mkdirSync(absDir, { recursive: true });
    fs.writeFileSync(absPath, Buffer.from(params.buffer));
  }
  return {
    localPath: "/" + relPath.split(path.sep).join("/"),
    absPath,
    sizeBytes: params.buffer.length,
  };
}
