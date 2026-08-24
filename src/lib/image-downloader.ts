/**
 * src/lib/image-downloader.ts
 *
 * 安全下载图片：
 *   - 仅允许 https://
 *   - 双重 MIME 白名单校验：HTTP Content-Type + 文件头 magic bytes
 *   - 下载失败重试 2 次 (1s → 3s 指数退避)
 *   - 返回 { buffer, sha256, contentType, detectedExt, width?, height? }
 *   - 不直接写文件，让调用方自己决定写到哪（便于 --dry-run）
 */

import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import { sha256Buffer } from "./hashes.js";

export type DownloadedImage = {
  buffer: Buffer;
  sha256: string;
  contentType: string; // 来自 HTTP 头
  detectedExt: "webp" | "png" | "jpeg";
  width: number | null;
  height: number | null;
};

export type DownloadOptions = {
  timeoutMs?: number;
  retries?: number; // 重试次数（不含首次）
  userAgent?: string;
  minWidth?: number; // 如果能探测到宽高，小于此值拒绝（默认 200，过滤头像）
};

export class ImageDownloadError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ImageDownloadError";
  }
}

const ALLOWED_MIME = new Set(["image/webp", "image/png", "image/jpeg", "image/jpg"]);

/** 根据文件头 magic bytes 检测类型 */
export function detectImageMagic(buf: Uint8Array): "webp" | "png" | "jpeg" | null {
  if (buf.length < 12) return null;
  const b = buf;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "png";
  }
  // WebP: RIFF....WEBP
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

/** 粗略地从 PNG/WebP/JPEG 头里解析宽高（不必精确） */
export function sniffDimensions(
  buf: Uint8Array,
  ext: "webp" | "png" | "jpeg"
): { width: number | null; height: number | null } {
  if (ext === "png" && buf.length >= 24) {
    // IHDR chunk starts at offset 8: length(4) + "IHDR"(4) + width(4) + height(4)
    const width = (buf[16]! << 24) | (buf[17]! << 16) | (buf[18]! << 8) | buf[19]!;
    const height = (buf[20]! << 24) | (buf[21]! << 16) | (buf[22]! << 8) | buf[23]!;
    return { width: width >>> 0, height: height >>> 0 };
  }
  if (ext === "webp" && buf.length >= 30) {
    // VP8 / VP8L / VP8X
    // RIFF(4) size(4) WEBP(4) chunk(4) ...
    // 简化版：找 "VP8 " / "VP8L" / "VP8X"
    const s = Buffer.from(buf).toString("binary", 12, Math.min(60, buf.length));
    let vp8x = s.indexOf("VP8X");
    if (vp8x >= 0) {
      // VP8X: 4 bytes sig + 4 bytes size + 1 byte flags + 3 bytes reserved +
      // WidthMinusOne (3 bytes LE) + HeightMinusOne (3 bytes LE)
      const o = 12 + vp8x + 8 + 4; // start of width
      if (o + 6 <= buf.length) {
        const w = (buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16)) + 1;
        const h =
          (buf[o + 3]! | (buf[o + 4]! << 8) | (buf[o + 5]! << 16)) + 1;
        return { width: w >>> 0, height: h >>> 0 };
      }
    }
    let vp8 = s.indexOf("VP8 ");
    if (vp8 >= 0) {
      // VP8 keyframe: after sig 28 bytes start code 0x9d 0x01 0x2a + 3 bytes dim
      const o = 12 + vp8 + 4 + 4 + 3 + 1 + 1 + 1; // approx
      const dimOff = 12 + vp8 + 14;
      if (dimOff + 4 <= buf.length) {
        const w = (buf[dimOff]! | (buf[dimOff + 1]! << 8)) & 0x3fff;
        const h = (buf[dimOff + 2]! | (buf[dimOff + 3]! << 8)) & 0x3fff;
        if (w > 0 && h > 0) return { width: w, height: h };
      }
      void o;
    }
  }
  if (ext === "jpeg") {
    // 找 SOF0 (FF C0) marker: after FF C0 LL, skip 3 bytes, height(2) width(2)
    let i = 2; // skip SOI FF D8
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xda) break; // SOS, start of scan
      const segLen = (buf[i + 2]! << 8) | buf[i + 3]!;
      // SOF markers: 0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const h = (buf[i + 5]! << 8) | buf[i + 6]!;
        const w = (buf[i + 7]! << 8) | buf[i + 8]!;
        return { width: w, height: h };
      }
      if (!segLen) break;
      i += 2 + segLen;
    }
  }
  return { width: null, height: null };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch a URL once. Returns buffer + contentType.
 * 不做 MIME 校验，仅做 HTTP 层面。
 */
function fetchOnce(
  url: string,
  opts: Required<Pick<DownloadOptions, "timeoutMs" | "userAgent">>
): Promise<{ buf: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") {
        reject(
          new ImageDownloadError(
            `URL 必须是 https://，当前是 ${u.protocol}`,
            false
          )
        );
        return;
      }
      const req = https.get(
        {
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          headers: {
            "User-Agent": opts.userAgent,
            Accept:
              "image/webp,image/apng,image/avif,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
          },
          timeout: opts.timeoutMs,
        },
        (res) => {
          // Handle redirects (301/302/303/307/308). XHS CDN 有时会跳
          const sc = res.statusCode ?? 0;
          if (sc >= 300 && sc < 400 && res.headers.location) {
            const next = new URL(res.headers.location, url).toString();
            // 最多跳一次，再跳就交给 retry + 外部限制
            res.resume();
            fetchOnce(next, opts).then(resolve).catch(reject);
            return;
          }
          if (sc < 200 || sc >= 300) {
            res.resume();
            reject(
              new ImageDownloadError(
                `HTTP ${sc} when fetching ${url}`,
                sc === 408 || sc === 429 || sc >= 500
              )
            );
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            resolve({
              buf,
              contentType: (res.headers["content-type"] || "").split(";")[0]!.trim().toLowerCase(),
            });
          });
          res.on("error", (e) =>
            reject(new ImageDownloadError(`response error: ${e.message}`, true, e))
          );
        }
      );
      req.on("timeout", () => {
        req.destroy(new Error("timeout"));
      });
      req.on("error", (e) => {
        const netErr = e as NodeJS.ErrnoException;
        const retryable =
          ["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"].includes(
            netErr.code ?? ""
          );
        reject(new ImageDownloadError(`request error: ${e.message}`, retryable, e));
      });
    } catch (e) {
      reject(
        new ImageDownloadError(
          `fetch parse error: ${(e as Error).message}`,
          false,
          e
        )
      );
    }
  });
  // 防止 tree-shaker 抱怨 http 未使用
  void http;
}

export async function downloadImage(
  url: string,
  opts: DownloadOptions = {}
): Promise<DownloadedImage> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRetries = opts.retries ?? 2;
  const userAgent =
    opts.userAgent ??
    "Mozilla/5.0 (compatible; ningxia-xhs-scraper/1.0; +https://github.com/Minkelxy/ningxia-xhs-scraper)";
  const minWidth = opts.minWidth ?? 200;

  let lastErr: ImageDownloadError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { buf, contentType } = await fetchOnce(url, { timeoutMs, userAgent });
      if (!ALLOWED_MIME.has(contentType)) {
        throw new ImageDownloadError(
          `HTTP Content-Type='${contentType}' 不在白名单 image/webp|png|jpeg`,
          false
        );
      }
      const ext = detectImageMagic(buf);
      if (!ext) {
        throw new ImageDownloadError(
          "magic bytes 不是合法的 webp/png/jpeg（可能下载到 HTML 错误页）",
          false
        );
      }
      // 类型一致性：Content-Type 与 magic bytes 可略有差别（如 image/jpg vs image/jpeg）
      // 不强校验，只要 magic 对就行
      const dim = sniffDimensions(buf, ext);
      if (dim.width !== null && dim.width < minWidth) {
        throw new ImageDownloadError(
          `图片宽度 ${dim.width} < minWidth=${minWidth}，疑似头像小图，跳过`,
          false
        );
      }
      const sha256 = sha256Buffer(buf);
      return {
        buffer: buf,
        sha256,
        contentType,
        detectedExt: ext,
        width: dim.width,
        height: dim.height,
      };
    } catch (e) {
      if (e instanceof ImageDownloadError) {
        lastErr = e;
        if (!e.retryable) throw e;
      } else {
        lastErr = new ImageDownloadError(
          `未知错误: ${(e as Error).message}`,
          true,
          e
        );
      }
      if (attempt < maxRetries) {
        const backoff = attempt === 0 ? 1000 : 3000;
        await sleep(backoff);
      }
    }
  }
  throw lastErr ?? new ImageDownloadError("下载失败（未知原因）", true);
}
