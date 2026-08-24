#!/usr/bin/env tsx
/**
 * scripts/ingest-batch.ts
 *
 * 批量采集：
 *   --urls-file <urls.txt>      每行一个（HTML 文件路径 或 XHS URL）
 *   --html-dir <dir>            扫描目录下所有 .html 文件
 *
 * 行为：
 *   - 并发 1（默认）或 2（--concurrency 2，上限）；超限强制降级 + warning
 *   - 限速：每次 ingest 间隔 --rate-limit-ms (默认 3000ms, 最小 1000)
 *   - 单条失败不回滚（成功的条目持久化）；最终写 _batch_report.json 汇总
 *   - 退出码：0 全成功；1 有失败；2 参数错误
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestFromHtml, type IngestResult } from "./ingest-one.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type BatchReport = {
  startedAt: string;
  endedAt?: string;
  total: number;
  successCount: number;
  failedCount: number;
  failures: Array<{
    input: string;
    noteId?: string;
    error: string;
    retryable: boolean;
    exitCode: number;
  }>;
  successes: Array<{ input: string; noteId: string; quality: string; images: number }>;
  rateLimitMs: number;
  concurrency: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function collectInputs(opts: {
  urlsFile?: string;
  htmlDir?: string;
  root: string;
}): Array<{ type: "html"; path: string } | { type: "url"; url: string }> {
  const inputs: Array<{ type: "html"; path: string } | { type: "url"; url: string }> = [];
  if (opts.urlsFile) {
    if (!fs.existsSync(opts.urlsFile)) {
      throw new Error(`urls-file 不存在: ${opts.urlsFile}`);
    }
    const lines = fs
      .readFileSync(opts.urlsFile, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    for (const l of lines) {
      if (/^https?:\/\//i.test(l)) {
        inputs.push({ type: "url", url: l });
      } else if (l.endsWith(".html") || l.endsWith(".htm")) {
        inputs.push({ type: "html", path: path.resolve(l) });
      } else {
        // 尝试当路径
        if (fs.existsSync(l)) inputs.push({ type: "html", path: path.resolve(l) });
      }
    }
  }
  if (opts.htmlDir) {
    const d = opts.htmlDir;
    if (!fs.existsSync(d)) throw new Error(`html-dir 不存在: ${d}`);
    for (const f of fs.readdirSync(d)) {
      if (!/\.(html?)$/i.test(f)) continue;
      inputs.push({ type: "html", path: path.join(d, f) });
    }
  }
  // 去重
  const seen = new Set<string>();
  return inputs.filter((i) => {
    const k = i.type === "html" ? i.path : i.url;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function runBatch(params: {
  inputs: ReturnType<typeof collectInputs>;
  concurrency?: number;
  rateLimitMs?: number;
  root?: string;
  dryRun?: boolean;
  minImageWidth?: number;
  reportPath?: string;
}): Promise<BatchReport> {
  const concurrency = Math.min(2, Math.max(1, params.concurrency ?? 1));
  const rateLimitMs = Math.max(1000, params.rateLimitMs ?? 3000);
  const root = params.root ?? path.resolve(__dirname, "..");
  const reportPath =
    params.reportPath ?? path.resolve(root, "_batch_report.json");

  const inputs = params.inputs;
  const report: BatchReport = {
    startedAt: new Date().toISOString(),
    total: inputs.length,
    successCount: 0,
    failedCount: 0,
    failures: [],
    successes: [],
    rateLimitMs,
    concurrency,
  };

  let cursor = 0;
  let lastStart = 0;

  const worker = async () => {
    while (cursor < inputs.length) {
      const i = cursor++;
      const input = inputs[i]!;
      // 限速
      const now = performance.now();
      const wait = Math.max(0, rateLimitMs - (now - lastStart));
      if (wait > 0) await sleep(wait);
      lastStart = performance.now();

      let res: IngestResult;
      try {
        if (input.type === "html") {
          res = await ingestFromHtml(input.path, {
            root,
            dryRun: params.dryRun,
            minImageWidth: params.minImageWidth,
          });
        } else {
          // url 模式：MVP 占位，直接记录失败
          res = {
            ok: false,
            filesWritten: [],
            imagesDownloaded: 0,
            fetchErrors: [
              "--url 模式将在 Task 4 实现；请改用半人工 --html 模式",
            ],
            exitCode: 2,
          };
        }
      } catch (e) {
        res = {
          ok: false,
          filesWritten: [],
          imagesDownloaded: 0,
          fetchErrors: [`未捕获异常: ${(e as Error).message}`],
          exitCode: 1,
        };
      }
      if (res.ok && res.exitCode === 0) {
        report.successCount++;
        report.successes.push({
          input: input.type === "html" ? input.path : input.url,
          noteId: res.noteId ?? "(unknown)",
          quality: res.quality ?? "partial",
          images: res.imagesDownloaded,
        });
      } else {
        report.failedCount++;
        report.failures.push({
          input: input.type === "html" ? input.path : input.url,
          noteId: res.noteId,
          error: res.fetchErrors.join(" ; ") || "未知错误",
          retryable: res.exitCode === 3,
          exitCode: res.exitCode,
        });
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  report.endedAt = new Date().toISOString();
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  } catch {
    /* noop */
  }
  return report;
}

export function main(argv: string[] = process.argv): number {
  const program = new Command();
  program
    .name("ingest-batch")
    .description("批量采集多条笔记（支持 urls.txt 或 html-dir 两种输入）")
    .option("--urls-file <file>", "输入清单文件：每行 HTML 路径或 URL")
    .option("--html-dir <dir>", "扫描目录下所有 .html 批量解析")
    .option(
      "-c, --concurrency <n>",
      "并发数：1 (默认) 或 2（上限）；>2 会被强制降级",
      (v) => Number(v),
      1
    )
    .option(
      "--rate-limit-ms <ms>",
      "每次请求最小间隔（毫秒），默认 3000，最小 1000",
      (v) => Number(v),
      3000
    )
    .option("--dry-run", "仅解析不落盘", false)
    .option("--min-image-width <px>", "过滤图片最小宽 (px)", (v) => Number(v), 200)
    .option("--root <dir>", "素材库根目录", path.resolve(__dirname, ".."))
    .option(
      "--report-path <file>",
      "报告输出路径（默认 <root>/_batch_report.json）"
    )
    .action(async () => {
      const opts = program.opts<{
        urlsFile?: string;
        htmlDir?: string;
        concurrency: number;
        rateLimitMs: number;
        dryRun?: boolean;
        minImageWidth: number;
        root: string;
        reportPath?: string;
      }>();

      let c = opts.concurrency;
      if (c > 2) {
        console.warn("⚠️  --concurrency > 2：强制降级到 2（符合 XHS 限速约束）");
        c = 2;
      }
      if (!opts.urlsFile && !opts.htmlDir) {
        console.error("错误：必须提供 --urls-file 或 --html-dir（可同时）");
        program.help();
      }

      let inputs: Awaited<ReturnType<typeof collectInputs>>;
      try {
        inputs = collectInputs(opts);
      } catch (e) {
        console.error((e as Error).message);
        process.exit(2);
      }
      if (inputs.length === 0) {
        console.error("错误：没解析到任何有效输入");
        process.exit(2);
      }

      const report = await runBatch({
        inputs,
        concurrency: c,
        rateLimitMs: opts.rateLimitMs,
        root: opts.root,
        dryRun: opts.dryRun,
        minImageWidth: opts.minImageWidth,
        reportPath: opts.reportPath,
      });
      console.log(
        JSON.stringify(
          {
            summary: `${report.successCount}/${report.total} 成功，${report.failedCount} 失败`,
            successCount: report.successCount,
            failedCount: report.failedCount,
            total: report.total,
            failures: report.failures,
          },
          null,
          2
        )
      );
      process.exit(report.failedCount === 0 ? 0 : 1);
    });

  try {
    program.parse(argv, { from: "user" });
  } catch (e) {
    if (e instanceof Error && /(必须提供|错误：)/.test(e.message)) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv);
}
