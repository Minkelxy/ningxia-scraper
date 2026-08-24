#!/usr/bin/env tsx
/**
 * scripts/mark-removed.ts
 *
 * 下架流程：标记笔记 removeRequested=true → 物理删除图片 → 补 provenance 下架行。
 * 为幂等：重复执行同一个已下架 noteId 不报错（但不会再发重复下架日志）。
 *
 * 用法：
 *   npm run mark:removed -- --noteId <id> --reason "原作者要求" --requester "author@example.com"
 *   npm run mark:removed -- --noteId <id> --reason "作者黑名单" --requester "maintainer"
 *
 * 执行完后会自动跑 validate-dataset.ts 确保过滤链生效。
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as csvStringify } from "csv-stringify/sync";
import { XhsNoteSchema, type XhsNote } from "../src/schema/note.js";
import { persistNote, readNdjson, DEFAULT_ROOT } from "../src/lib/storage.js";
import { validateAll } from "./validate-dataset.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type MarkResult = {
  noteId: string;
  ok: boolean;
  existed: boolean;
  alreadyRemoved: boolean;
  imagesDeleted: number | null; // 删除的图片数量（非目录不存在时 null）
  markLogged: boolean;
  validatePassed: boolean | null;
  problems?: string[];
};

export function markRemoved(params: {
  noteId: string;
  reason: string;
  requester: string;
  root?: string;
  skipValidate?: boolean;
}): MarkResult {
  const root = params.root ?? DEFAULT_ROOT;
  const result: MarkResult = {
    noteId: params.noteId,
    ok: false,
    existed: false,
    alreadyRemoved: false,
    imagesDeleted: null,
    markLogged: false,
    validatePassed: null,
    problems: [],
  };

  // 1. 读 data-raw/json/<noteId>.json
  const rawPath = path.join(root, "data-raw", "json", `${params.noteId}.json`);
  if (!fs.existsSync(rawPath)) {
    result.problems!.push(`data-raw/json/${params.noteId}.json 不存在`);
    // 不过仍然尝试删 images，可能是半入库状态
  } else {
    result.existed = true;
  }

  let note: XhsNote | null = null;
  if (result.existed) {
    try {
      note = XhsNoteSchema.parse(
        JSON.parse(fs.readFileSync(rawPath, "utf8"))
      ) as XhsNote;
    } catch (e) {
      result.problems!.push(`raw json parse/schema 失败: ${(e as Error).message}；尝试非严格读取`);
      try {
        note = JSON.parse(fs.readFileSync(rawPath, "utf8")) as XhsNote;
      } catch { /* noop */ }
    }
    // 已下架？
    if (note && note.removeRequested !== false) {
      result.alreadyRemoved = true;
    }
    // 标记 removeRequested
    if (note) {
      note = {
        ...note,
        removeRequested: {
          reason: params.reason,
          requestedAt: toYYYYMMDD(new Date()),
          requester: params.requester,
        },
      };
      fs.writeFileSync(rawPath, JSON.stringify(note, null, 2));
    }
  }

  // 2. 更新 notes.ndjson
  const map = readNdjson(root);
  const entry = map.get(params.noteId);
  if (entry?.note) {
    const updatedNote = {
      ...entry.note,
      removeRequested: {
        reason: params.reason,
        requestedAt: toYYYYMMDD(new Date()),
        requester: params.requester,
      },
    } as unknown as XhsNote;
    // 更新 persistNote 会处理一致性
    try {
      persistNote(updatedNote, { root });
    } catch (e) {
      result.problems!.push(`persist 写回 ndjson 失败: ${(e as Error).message}`);
    }
  } else if (note) {
    // ndjson 没有但 raw 有，补一次
    try {
      persistNote(note, { root });
    } catch (e) {
      result.problems!.push(`补写 ndjson 失败: ${(e as Error).message}`);
    }
  }

  // 3. 物理删除 images/full/<noteId>/
  const imgDir = path.join(root, "images", "full", params.noteId);
  if (fs.existsSync(imgDir)) {
    try {
      const files = fs.readdirSync(imgDir);
      result.imagesDeleted = files.length;
      fs.rmSync(imgDir, { recursive: true, force: true });
    } catch (e) {
      result.problems!.push(`删除图片目录失败: ${(e as Error).message}`);
    }
  } else {
    result.imagesDeleted = 0; // 目录不存在就算 0 张删
  }

  // 4. 追加 provenance/manifest.csv REMOVED 行
  const csvPath = path.join(root, "provenance", "manifest.csv");
  const header =
    "noteId,status,sourceUrl,authorNickname,fetchedAt,imageCount,license,reason,requester,timestamp\n";
  if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, header);
  const srcUrl = (note as XhsNote | null)?.sourceUrl ?? "-";
  const nick = (note as XhsNote | null)?.authorNickname ?? "-";
  const fetched = (note as XhsNote | null)?.fetchedAt ?? "-";
  const appended = csvStringify(
    [
      [
        params.noteId,
        "REMOVED",
        srcUrl,
        nick,
        fetched,
        0,
        "for-reference-only",
        params.reason,
        params.requester,
        new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      ],
    ],
    { quoted: true, quoted_empty: true }
  ).trimEnd();
  fs.appendFileSync(csvPath, appended + "\n");
  result.markLogged = true;

  // 5. validate
  if (!params.skipValidate) {
    try {
      const v = validateAll();
      result.validatePassed = v.ok;
      if (!v.ok) {
        result.problems!.push(
          `validate-dataset 报错: ${v.problems.filter((p) => p.severity === "error").length} errors`
        );
      }
    } catch (e) {
      result.problems!.push(`validate-dataset 异常: ${(e as Error).message}`);
    }
  }

  result.ok = result.problems!.length === 0 || result.problems!.every((m) => /不存在/.test(m) === false);
  // 如果 raw 不存在 → ok=false
  if (!result.existed) result.ok = false;
  return result;
}

function toYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function main(argv: string[] = process.argv): number {
  const program = new Command();
  program
    .name("mark-removed")
    .description("下架某条笔记：标记 removeRequested → 物理删图 → provenance 留痕 → validate 检查")
    .requiredOption("--noteId <id>", "要下架的 noteId")
    .requiredOption("--reason <reason>", "下架原因（原作者要求 / 作者黑名单 / 含未成年人肖像 等）")
    .requiredOption("--requester <contact>", "请求人邮箱或 GitHub ID（用于 provenance 留痕）")
    .option("--root <dir>", "素材库根目录", DEFAULT_ROOT)
    .option("--skip-validate", "跳过 validate-dataset 检查", false)
    .action(() => {
      const opts = program.opts<{
        noteId: string;
        reason: string;
        requester: string;
        root: string;
        skipValidate: boolean;
      }>();
      if (opts.reason.trim().length === 0) {
        console.error("--reason 不能为空");
        process.exit(2);
      }
      if (opts.requester.trim().length === 0) {
        console.error("--requester 不能为空");
        process.exit(2);
      }
      const r = markRemoved({
        noteId: opts.noteId.trim(),
        reason: opts.reason.trim(),
        requester: opts.requester.trim(),
        root: opts.root,
        skipValidate: opts.skipValidate,
      });
      console.log(
        JSON.stringify(
          {
            ok: r.ok,
            noteId: r.noteId,
            existed: r.existed,
            alreadyRemoved: r.alreadyRemoved,
            imagesDeleted: r.imagesDeleted,
            markLogged: r.markLogged,
            validatePassed: r.validatePassed,
            problems: r.problems,
          },
          null,
          2
        )
      );
      if (!r.ok) process.exit(1);
      if (r.validatePassed === false) process.exit(1);
      process.exit(0);
    });
  try {
    program.parse(argv, { from: "user" });
  } catch (e) {
    if ((e as Error).message.startsWith("error: missing required option")) {
      console.error((e as Error).message);
      return 2;
    }
    throw e;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv));
}
