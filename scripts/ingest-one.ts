#!/usr/bin/env tsx
/**
 * scripts/ingest-one.ts
 *
 * 单条 XHS 笔记采集 CLI（模式 A：离线 HTML 解析 + 模式 B：Playwright URL 抓取）。
 *
 * 模式 A --html <file>   （默认推荐 · 零风控 · 无需浏览器）
 * 模式 B --url  <url>    （可选 · 需 Playwright + robots 合规 · 本 MVP 暂做占位，抛错请用模式 A）
 *
 * 退出码语义（NFR-5）：
 *   0 成功
 *   1 业务失败（解析失败、Schema 校验失败、图片下载整体失败等）
 *   2 参数错误
 *   3 网络错误（重试用尽）
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  XhsNoteSchema,
  LICENSE,
  VERIFICATION_HINT,
  makeSourceId,
  type XhsNote,
  type ImageAsset,
  type Platform,
} from "../src/schema/note.js";
import { parseHtml, sniffPlatform, toYYYYMMDD } from "../src/lib/html-parser.js";
import { md5, bodySimhash, dHashFromImageBuffer } from "../src/lib/hashes.js";
import {
  downloadImage,
  ImageDownloadError,
} from "../src/lib/image-downloader.js";
import {
  persistNote,
  saveImageFile,
  ensureDirs,
  DEFAULT_ROOT,
} from "../src/lib/storage.js";

export type IngestResult = {
  ok: boolean;
  noteId?: string;
  quality?: "full" | "partial" | "images-only";
  filesWritten: string[];
  imagesDownloaded: number;
  fetchErrors: string[];
  exitCode: 0 | 1 | 2 | 3;
};

/**
 * 核心：从已解析的 HTML 结果 + 图片下载，组装 XhsNote 并持久化。
 */
export async function ingestFromHtml(
  htmlPath: string,
  opts: {
    dryRun?: boolean | undefined;
    root?: string | undefined;
    hintNoteId?: string | undefined;
    minImageWidth?: number | undefined;
    platform?: Platform | undefined;
  } = {}
): Promise<IngestResult> {
  const root = opts.root ?? DEFAULT_ROOT;
  const dryRun = !!opts.dryRun;
  const fetchErrors: string[] = [];
  const filesWritten: string[] = [];
  let quality: "full" | "partial" | "images-only" = "full";

  if (!fs.existsSync(htmlPath)) {
    return {
      ok: false,
      filesWritten,
      imagesDownloaded: 0,
      fetchErrors: [`HTML 文件不存在: ${htmlPath}`],
      exitCode: 2,
    };
  }

  if (!dryRun) ensureDirs(root);

  const html = fs.readFileSync(htmlPath, "utf8");
  let platform: Platform | undefined = opts.platform;
  if (!platform) {
    const sniffed = sniffPlatform(html);
    if (!sniffed) {
      return {
        ok: false, filesWritten, imagesDownloaded: 0,
        fetchErrors: ["无法从 HTML 嗅探平台（未命中 xhs/weibo/ctrip 标志）；请用 --platform <xhs|weibo|ctrip> 显式指定"],
        exitCode: 2,
      };
    }
    platform = sniffed;
  }
  const parsed = parseHtml(html, platform, opts.hintNoteId);

  if (!parsed.noteId) {
    // 最后兜底：用文件名 (去掉 .html) 做 noteId
    const base = path.basename(htmlPath).replace(/\.html?$/i, "");
    if (base && /^[A-Za-z0-9_-]+$/.test(base)) {
      parsed.noteId = base;
    } else if (parsed.sourceUrl) {
      const m = parsed.sourceUrl.match(/\/explore\/([A-Za-z0-9_-]+)/);
      if (m && m[1]) parsed.noteId = m[1];
    }
  }
  if (!parsed.noteId) {
    return {
      ok: false,
      filesWritten,
      imagesDownloaded: 0,
      fetchErrors: [
        "无法从 HTML 或文件名推断 noteId；请用 --hint-note-id 指定，或把 HTML 重命名为 <noteId>.html",
      ],
      exitCode: 1,
    };
  }

  // 下载图片
  const images: ImageAsset[] = [];
  let imagesDownloaded = 0;
  const firstPerceptual: string[] = [];

  for (let i = 0; i < parsed.imageUrls.length; i++) {
    const { url, caption } = parsed.imageUrls[i]!;
    try {
      const dl = await downloadImage(url, {
        retries: 2,
        minWidth: opts.minImageWidth ?? 200,
      });
      // 写文件
      const saved = saveImageFile({
        root,
        noteId: parsed.noteId,
        index: i,
        ext: dl.detectedExt,
        buffer: dl.buffer,
        dryRun,
      });
      const imageAsset: ImageAsset = {
        sha256: dl.sha256,
        originalUrl: url,
        localPath: saved.localPath,
        width: dl.width,
        height: dl.height,
        captionFromNote: caption ?? null,
        license: LICENSE,
      };
      images.push(imageAsset);
      imagesDownloaded++;
      // 感知哈希
      try {
        const phash = await dHashFromImageBuffer(dl.buffer, async (b) => {
          const { data } = await sharp(Buffer.from(b))
            .grayscale()
            .resize(9, 8, { fit: "fill" })
            .raw()
            .toBuffer({ resolveWithObject: true });
          return data;
        });
        if (images.length === 1) firstPerceptual.push(phash);
      } catch {
        // 感知哈希失败不影响整体
      }
      if (!dryRun) filesWritten.push(saved.localPath.replace(/^\//, ""));
    } catch (e) {
      const msg =
        e instanceof ImageDownloadError
          ? `图片#${i + 1} 下载失败: ${e.message} (retryable=${e.retryable})`
          : `图片#${i + 1} 下载异常: ${(e as Error).message}`;
      fetchErrors.push(msg);
    }
  }

  // 质量分级
  if (images.length === 0 && !parsed.bodyPlainText) {
    quality = "partial";
  } else if (images.length > 0 && !parsed.bodyPlainText) {
    quality = "images-only";
  } else if (fetchErrors.length > 0 || !parsed.title || !parsed.publishedAt) {
    quality = "partial";
  } else {
    quality = "full";
  }

  // 如果 sourceUrl 还没拿到，按平台补一个合成的兜底
  const fallbackUrl =
    platform === "weibo" ? `https://m.weibo.cn/detail/${parsed.noteId}`
    : platform === "ctrip" ? `https://you.ctrip.com/TravelBlogs/${parsed.noteId}.html`
    : `https://www.xiaohongshu.com/explore/${parsed.noteId}`;
  const sourceUrl = parsed.sourceUrl ?? fallbackUrl;

  // 构造 note 对象
  const bodyForSig = parsed.bodyPlainText ?? parsed.title ?? "";
  const note: XhsNote = {
    noteId: parsed.noteId,
    source_id: makeSourceId(parsed.noteId, platform),
    fetchedAt: toYYYYMMDD(new Date()),
    sourceUrl,
    sourcePlatform: platform,
    authorNickname: parsed.authorNickname ?? "未知作者",
    title: parsed.title,
    bodyHtml: parsed.bodyHtml,
    bodyPlainText: parsed.bodyPlainText,
    publishedAt: parsed.publishedAt,
    topics: parsed.topics,
    geoHint: parsed.geoHint,
    likeCount: parsed.interaction.likeCount,
    collectCount: parsed.interaction.collectCount,
    commentCount: parsed.interaction.commentCount,
    images,
    ingestQuality: quality,
    verificationLevelHint: VERIFICATION_HINT,
    dedupeSignatures: {
      titleMd5: md5(parsed.title ?? ""),
      bodySimhash: bodySimhash(bodyForSig),
      firstImagePerceptualHash: firstPerceptual,
    },
    removeRequested: false,
    _meta: {
      fetchErrors,
      suspectedDuplicateOf: [],
      retryCount: 0,
      ingestMode: "html",
    },
  };

  // Schema 校验
  const parsedSchema = XhsNoteSchema.safeParse(note);
  if (!parsedSchema.success) {
    const issues = parsedSchema.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    fetchErrors.unshift(`Zod Schema 校验失败: ${issues}`);
    return {
      ok: false,
      noteId: parsed.noteId,
      quality,
      filesWritten,
      imagesDownloaded,
      fetchErrors,
      exitCode: 1,
    };
  }
  const finalNote = parsedSchema.data;

  // 写存储
  if (!dryRun) {
    const res = persistNote(finalNote, { root, dryRun: false });
    filesWritten.push(...res.filesWritten);
  } else {
    filesWritten.push(
      `data-raw/json/${finalNote.noteId}.json`,
      "data/notes.ndjson",
      "data/notes-index.json",
      "provenance/manifest.csv"
    );
  }

  // 网络错误：图片下载中出现 retryable=true 且最终失败的多 → 标 exitCode 3
  const hasRetryableNetError = fetchErrors.some((m) => /retryable=true/.test(m));
  let exitCode: 0 | 1 | 2 | 3 = 0;
  if (!parsed.bodyPlainText && images.length === 0) exitCode = 1;
  else if (hasRetryableNetError && imagesDownloaded < Math.max(1, parsed.imageUrls.length / 2))
    exitCode = 3;

  return {
    ok: exitCode === 0,
    noteId: finalNote.noteId,
    quality,
    filesWritten,
    imagesDownloaded,
    fetchErrors,
    exitCode,
  };
}

export function main(argv: string[] = process.argv): number {
  const program = new Command();
  program
    .name("ingest-one")
    .description("解析一条 XHS 笔记（离线 HTML 或 URL），写入标准化数据集 + 图片 + provenance")
    .option("--html <file>", "模式 A：离线解析另存的 XHS 笔记 HTML 文件路径")
    .option("--url <url>", "模式 B：直接抓取 URL（MVP 阶段占位，若 robots Disallow 会拒绝）")
    .option("--hint-note-id <id>", "无法从 HTML 推断 noteId 时手动指定")
    .option("--dry-run", "仅解析并打印将要写入的文件，不落盘", false)
    .option("--min-image-width <px>", "过滤掉宽度小于此值的图片（默认 200）", (v) => Number(v), 200)
    .option("--root <dir>", "素材库根目录（默认脚本上级目录）", DEFAULT_ROOT)
    .option("--platform <p>", "目标平台 xhs | weibo | ctrip；不传则自动嗅探 HTML", (v: string) => {
      if (v !== "xhs" && v !== "weibo" && v !== "ctrip") throw new Error(`未知 --platform: ${v}（仅支持 xhs/weibo/ctrip）`);
      return v as Platform;
    })
    .action(async () => {
      const opts = program.opts<{
        html?: string;
        url?: string;
        hintNoteId?: string;
        dryRun?: boolean;
        minImageWidth?: number;
        root?: string;
        platform?: Platform;
      }>();

      if (!opts.html && !opts.url) {
        console.error("错误：必须提供 --html <file> 或 --url <url> 其中之一");
        program.help();
      }

      let res: IngestResult;
      if (opts.html) {
        res = await ingestFromHtml(path.resolve(opts.html), {
          dryRun: opts.dryRun,
          root: opts.root,
          hintNoteId: opts.hintNoteId,
          minImageWidth: opts.minImageWidth,
          platform: opts.platform,
        });
      } else {
        // 模式 B (--url) 是 Task 4 的工作，MVP 阶段先提供清晰错误
        console.error(
          [
            "--url 模式（Playwright 自动化）将在后续版本实现。",
            "当前请使用 --html 模式：",
            "  1) 在浏览器里打开对应平台笔记",
            "  2) Ctrl+S → 另存为完整 HTML",
            "  3) npm run ingest:one -- --platform <xhs|weibo|ctrip> --html /path/to/saved.html",
          ].join("\n")
        );
        process.exit(2);
      }

      console.log(
        JSON.stringify(
          {
            ok: res.ok,
            noteId: res.noteId ?? null,
            quality: res.quality ?? null,
            imagesDownloaded: res.imagesDownloaded,
            fetchErrors: res.fetchErrors,
            filesWritten: res.filesWritten,
          },
          null,
          2
        )
      );
      process.exit(res.exitCode);
    });

  try {
    program.parse(argv, { from: "user" });
  } catch (e) {
    if (e instanceof Error && /(must provide|错误：)/.test(e.message)) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
  // TS 要求有 return；实际上 program.parse 之后到了这里意味着使用了 action
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // main() 内部会调用 process.exit
  main(process.argv);
}
