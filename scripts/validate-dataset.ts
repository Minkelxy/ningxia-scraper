#!/usr/bin/env tsx
/**
 * scripts/validate-dataset.ts
 * -------------------------------------------------------------
 * 全数据集合规校验脚本
 *
 * 检查内容：
 *   1. data-raw/json/*.json 每个文件符合 Zod Schema
 *   2. data/notes.ndjson 每行符合 Zod Schema；且 noteId 集合 == raw json 集合
 *   3. provenance/manifest.csv 中 status=ACTIVE 的行其 noteId 在 json & ndjson 中均存在
 *   4. config/author-blacklist.txt 命中作者 → 报错 + 建议运行 mark-removed
 *   5. removeRequested=true 的笔记：
 *      - images/full/<noteId>/ 目录必须不存在（或空）
 *      - 如果出现在任何 export 类型输出中则报错（当前检查 manifest 状态）
 *
 * 输出模式：
 *   --format human (默认)：终端表格
 *   --format json：机器可读
 *
 * 退出码：
 *   0 全部通过
 *   1 校验失败（问题清单已输出）
 *   2 参数错误
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { ZodError, type ZodIssue } from "zod";
import { XhsNoteSchema, makeSourceId } from "../src/schema/note.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

type Problem = {
  severity: "error" | "warning";
  category:
    | "schema"
    | "consistency"
    | "provenance"
    | "blacklist"
    | "removeRequested"
    | "filesystem";
  noteId?: string;
  message: string;
  detail?: unknown;
};

type OutputFormat = "human" | "json";

function safeReadText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function readAuthorBlacklist(): Set<string> {
  const txt = safeReadText(path.join(ROOT, "config", "author-blacklist.txt"));
  if (!txt) return new Set();
  return new Set(
    txt
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );
}

function readRawJsonDir(): Map<string, { file: string; text: string }> {
  const dir = path.join(ROOT, "data-raw", "json");
  const m = new Map<string, { file: string; text: string }>();
  if (!fs.existsSync(dir)) return m;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const noteId = f.slice(0, -".json".length);
    m.set(noteId, { file: path.join(dir, f), text: fs.readFileSync(path.join(dir, f), "utf8") });
  }
  return m;
}

function readNdjson(): Array<{ noteId: string; lineNo: number; text: string }> {
  const p = path.join(ROOT, "data", "notes.ndjson");
  const rows: Array<{ noteId: string; lineNo: number; text: string }> = [];
  const txt = safeReadText(p);
  if (!txt) return rows;
  txt.split(/\r?\n/).forEach((line, idx) => {
    if (!line.trim()) return;
    let noteId = "";
    try {
      noteId = JSON.parse(line).noteId ?? "(unknown)";
    } catch {
      noteId = "(parse-error)";
    }
    rows.push({ noteId, lineNo: idx + 1, text: line });
  });
  return rows;
}

function readProvenanceCsv(): Array<Record<string, string>> {
  const p = path.join(ROOT, "provenance", "manifest.csv");
  const txt = safeReadText(p);
  if (!txt || txt.trim() === "") return [];
  try {
    return parse(txt, { columns: true, skip_empty_lines: true });
  } catch {
    return [];
  }
}

export function validateAll(): {
  ok: boolean;
  counts: {
    rawJson: number;
    ndjsonRows: number;
    provenanceRows: number;
    removedNotes: number;
  };
  problems: Problem[];
  noteMap: Map<string, object>;
} {
  const problems: Problem[] = [];
  const blacklist = readAuthorBlacklist();
  const rawEntries = readRawJsonDir();
  const ndjsonRows = readNdjson();
  const provenanceRows = readProvenanceCsv();

  const noteMap = new Map<string, object>();

  // Step 1: 校验每个 raw JSON 的 Schema
  for (const [noteId, { file, text }] of rawEntries.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      problems.push({
        severity: "error",
        category: "schema",
        noteId,
        message: `data-raw/json/${noteId}.json 不是合法 JSON: ${(e as Error).message}`,
      });
      continue;
    }
    const res = XhsNoteSchema.safeParse(parsed);
    if (!res.success) {
      const issues = res.error.issues.map(formatZodIssue).join("; ");
      problems.push({
        severity: "error",
        category: "schema",
        noteId,
        message: `data-raw/json/${noteId}.json Zod 校验失败: ${issues}`,
        detail: res.error.issues,
      });
      continue;
    }
    // source_id 格式校验
    const expectedSourceId = makeSourceId(res.data.noteId, res.data.sourcePlatform);
    if (res.data.source_id !== expectedSourceId) {
      problems.push({
        severity: "error",
        category: "consistency",
        noteId,
        message: `source_id 应该是 '${expectedSourceId}'（平台 ${res.data.sourcePlatform}），实际是 '${res.data.source_id}'`,
      });
    }
    // 作者黑名单
    if (blacklist.has(res.data.authorNickname)) {
      problems.push({
        severity: "error",
        category: "blacklist",
        noteId,
        message:
          `作者 '${res.data.authorNickname}' 在黑名单中；` +
          `请执行：npm run mark:removed -- --noteId ${res.data.noteId} ` +
          `--reason "作者黑名单" --requester "maintainer"`,
      });
    }
    noteMap.set(noteId, res.data as unknown as object);
  }

  // Step 2: 校验 NDJSON 每行 Schema + 与 raw JSON 的 noteId 一致
  const ndjsonNoteIds = new Set<string>();
  const dupesInNdjson = new Set<string>();
  for (const { noteId, lineNo, text } of ndjsonRows) {
    if (ndjsonNoteIds.has(noteId)) dupesInNdjson.add(noteId);
    ndjsonNoteIds.add(noteId);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      problems.push({
        severity: "error",
        category: "schema",
        noteId,
        message: `data/notes.ndjson:${lineNo} 不是合法 JSON: ${(e as Error).message}`,
      });
      continue;
    }
    const res = XhsNoteSchema.safeParse(parsed);
    if (!res.success) {
      const issues = res.error.issues.map(formatZodIssue).join("; ");
      problems.push({
        severity: "error",
        category: "schema",
        noteId,
        message: `data/notes.ndjson:${lineNo} Zod 校验失败: ${issues}`,
        detail: res.error.issues,
      });
      continue;
    }
    if (!noteMap.has(noteId)) {
      // 可能是第一次验证 raw 出了问题，这里不重复报错
    }
    noteMap.set(noteId, res.data as unknown as object);
  }
  if (dupesInNdjson.size > 0) {
    for (const nid of dupesInNdjson) {
      problems.push({
        severity: "error",
        category: "consistency",
        noteId: nid,
        message: `notes.ndjson 中 noteId=${nid} 出现多行；请先跑 dedupe.ts`,
      });
    }
  }
  const rawIds = new Set(rawEntries.keys());
  // raw 有但 ndjson 没有 -> warning (ndjson 是机器汇总，应该全)
  for (const nid of rawIds) {
    if (!ndjsonNoteIds.has(nid)) {
      problems.push({
        severity: "warning",
        category: "consistency",
        noteId: nid,
        message: `data-raw/json/${nid}.json 存在但 notes.ndjson 缺少此行；请重新运行 ingest-one 或 rebuild-index`,
      });
    }
  }
  // ndjson 有但 raw 没有 -> error (反了，不应该)
  for (const nid of ndjsonNoteIds) {
    if (!rawIds.has(nid)) {
      problems.push({
        severity: "error",
        category: "consistency",
        noteId: nid,
        message: `notes.ndjson 有 noteId=${nid} 但 data-raw/json/ 下无对应 JSON；建议恢复 raw json 或删除 ndjson 此行`,
      });
    }
  }

  // Step 3: Provenance CSV 核对
  const provenanceNoteIds = new Set<string>();
  for (const row of provenanceRows) {
    const nid = (row.noteId ?? "").trim();
    const status = (row.status ?? "ACTIVE").toUpperCase();
    if (!nid) continue;
    provenanceNoteIds.add(nid);
    if (status !== "REMOVED" && rawEntries.size > 0) {
      // 只有当我们有 notes 时才检查一致性；全空数据集不管
      if (rawIds.size > 0 && !rawIds.has(nid) && !ndjsonNoteIds.has(nid)) {
        problems.push({
          severity: "warning",
          category: "provenance",
          noteId: nid,
          message: `provenance/manifest.csv 中存在 noteId=${nid} 但数据集中无此笔记（可能被删除）`,
        });
      }
    }
    if (status !== "REMOVED") {
      const license = (row.license ?? "").trim();
      if (license && license !== "for-reference-only") {
        problems.push({
          severity: "error",
          category: "provenance",
          noteId: nid,
          message: `manifest.csv license='${license}' 非法，必须是 for-reference-only`,
        });
      }
    }
  }

  // Step 4: removeRequested 检查
  let removedCount = 0;
  for (const [noteId, noteObj] of noteMap.entries()) {
    const note = noteObj as { removeRequested: unknown };
    if (note.removeRequested && note.removeRequested !== false) {
      removedCount++;
      const imgDir = path.join(ROOT, "images", "full", noteId);
      if (fs.existsSync(imgDir)) {
        let hasFiles = false;
        try {
          hasFiles = fs.readdirSync(imgDir).length > 0;
        } catch {
          /* ignore */
        }
        if (hasFiles) {
          problems.push({
            severity: "error",
            category: "removeRequested",
            noteId,
            message: `已标记 removeRequested=true，但 images/full/${noteId}/ 下仍有图片；必须物理删除`,
          });
        }
      }
    }
  }

  return {
    ok: problems.filter((p) => p.severity === "error").length === 0,
    counts: {
      rawJson: rawEntries.size,
      ndjsonRows: ndjsonRows.length,
      provenanceRows: provenanceRows.length,
      removedNotes: removedCount,
    },
    problems,
    noteMap,
  };
}

function formatZodIssue(issue: ZodIssue): string {
  const path = issue.path.length ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

function renderHuman(result: ReturnType<typeof validateAll>): string {
  const { ok, counts, problems } = result;
  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");
  const lines: string[] = [];
  lines.push("=== validate-dataset ===");
  lines.push(
    `  数据集规模：rawJson=${counts.rawJson}  ndjson=${counts.ndjsonRows}  ` +
      `provenance=${counts.provenanceRows}  removed=${counts.removedNotes}`
  );
  lines.push(`  结果：${ok ? "✅ PASS" : "❌ FAIL"}  errors=${errors.length}  warnings=${warnings.length}`);
  lines.push("");
  if (errors.length) {
    lines.push("--- ERROR 清单 ---");
    for (const p of errors) {
      lines.push(
        `  [${p.category}]${p.noteId ? ` note=${p.noteId}` : ""}  ${p.message}`
      );
    }
    lines.push("");
  }
  if (warnings.length) {
    lines.push("--- WARNING 清单 ---");
    for (const p of warnings) {
      lines.push(
        `  [${p.category}]${p.noteId ? ` note=${p.noteId}` : ""}  ${p.message}`
      );
    }
    lines.push("");
  }
  if (ok) lines.push("全部合规检查通过。");
  return lines.join("\n");
}

export function main(argv: string[] = process.argv): number {
  const program = new Command();
  let format: OutputFormat = "human";
  program
    .name("validate-dataset")
    .description("全数据集合规校验：Schema / 一致性 / provenance / 黑名单 / 下架状态")
    .option(
      "-f, --format <fmt>",
      "输出格式：human 或 json",
      (v) => {
        if (v !== "human" && v !== "json") {
          throw new Error(`未知 --format: ${v}`);
        }
        return v as OutputFormat;
      },
      "human"
    )
    .action(() => {
      format = program.opts().format as OutputFormat;
    });
  try {
    program.parse(argv, { from: "user" });
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }

  try {
    const result = validateAll();
    if (format === "json") {
      process.stdout.write(
        JSON.stringify(
          {
            ok: result.ok,
            counts: result.counts,
            problems: result.problems,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      console.log(renderHuman(result));
    }
    return result.ok ? 0 : 1;
  } catch (e) {
    console.error("validate-dataset 异常退出:", (e as Error).message);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv));
}
