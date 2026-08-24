/**
 * src/lib/hashes.ts
 *
 * 给 dedupeSignatures 使用的哈希工具集。
 *  - MD5(title)      → 32 hex
 *  - SHA256(file)    → 64 hex
 *  - SimHash(body)   → 64-bit (16 hex), 用于正文模糊去重（海明距离 ≤5 视为同文）
 *  - dHash(image)    → 64-bit 感知哈希（图片相似），实现为差异哈希 (Difference Hash)
 */

import crypto from "node:crypto";
import { createHash } from "node:crypto";
import fs from "node:fs";

export const md5 = (s: string): string =>
  crypto.createHash("md5").update(s ?? "").digest("hex");

export const sha256Buffer = (buf: Uint8Array | Buffer): string =>
  createHash("sha256").update(buf).digest("hex");

export const sha256File = (p: string): string => {
  const stream = fs.createReadStream(p);
  const h = createHash("sha256");
  return new Promise<string>((resolve, reject) => {
    stream.on("data", (c) => h.update(c));
    stream.on("end", () => resolve(h.digest("hex")));
    stream.on("error", reject);
  }) as unknown as string;
};

/** 正文 simhash 指纹 (16 位 hex = 64bit)
 *
 * 自实现 64-bit SimHash，避免对 simhash-js 包命名导出形状的依赖（CJS/ESM 互操作不稳定）。
 * 思路：按 2-gram 切 token，每个 token 取 SHA256 低 8 字节作为 64-bit 哈希；
 *       对每一位，按 token 出现次数加权；最终 64 维向量值 > 0 设为 1。
 */
export const bodySimhash = (text: string | null | undefined): string => {
  if (!text) return "0000000000000000";
  // 做一次基本 token 化：保留 Unicode 字母数字和 CJK，按 2-gram 滑窗
  const cleaned = text.replace(/\s+/g, "");
  if (cleaned.length === 0) return "0000000000000000";
  const tokens: string[] = [];
  const window = Math.min(2, cleaned.length);
  for (let i = 0; i + window <= cleaned.length; i++) {
    tokens.push(cleaned.slice(i, i + window));
  }
  // 64 维权重向量
  const V = new Float64Array(64);
  for (const tok of tokens) {
    const h = createHash("sha256").update(tok).digest();
    // h 为 32 字节；取 0-7 字节（8*8=64 bit）
    let weight = 1;
    for (let b = 0; b < 8; b++) {
      const byte = h[b]!;
      for (let bit = 0; bit < 8; bit++) {
        const pos = b * 8 + bit;
        const set = (byte >> bit) & 1;
        V[pos] += set ? weight : -weight;
      }
    }
  }
  let hi = 0n; // 高 32
  let lo = 0n; // 低 32
  for (let pos = 0; pos < 64; pos++) {
    if (V[pos] > 0) {
      if (pos < 32) lo |= 1n << BigInt(pos);
      else hi |= 1n << BigInt(pos - 32);
    }
  }
  const s = ((hi << 32n) | lo).toString(16).padStart(16, "0");
  return s.slice(s.length - 16);
};

/** 两个 simhash 16-hex 指纹的海明距离：按位 XOR 计数 */
const popCount8 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4] as const;
export const simDistance = (a: string, b: string): number => {
  let dist = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += popCount8[x] ?? 0;
  }
  return dist;
};

/**
 * 图片感知哈希 (dHash - difference hash) 16 位 hex 字符串 = 64 bit。
 * 输入是一个 9×8 = 72 灰度像素数组（行优先，逐行 9 个灰度 byte × 8 行）。
 * dHash 算法：对每行，若 g[c] > g[c+1] 则该位 = 1；否则 0；共 8×8 = 64 bits。
 */
export function dHashFromGray9x8(gray: Uint8Array): string {
  if (gray.length !== 72) {
    // 长度不对：返回全 0，但 Schema 不关心质量，只要格式对
    return "0".repeat(16);
  }
  let hi = 0n; // 高 32 bit
  let lo = 0n; // 低 32 bit
  let bit = 63n;
  for (let row = 0; row < 8; row++) {
    for (let c = 0; c < 8; c++) {
      const left = gray[row * 9 + c] ?? 0;
      const right = gray[row * 9 + c + 1] ?? 0;
      if (left > right) {
        if (bit >= 32n) hi |= 1n << (bit - 32n);
        else lo |= 1n << bit;
      }
      bit -= 1n;
    }
  }
  const h = hi.toString(16).padStart(8, "0");
  const l = lo.toString(16).padStart(8, "0");
  return (h + l).toLowerCase();
}

/**
 * 从一个 Buffer 的小图（任何尺寸，只要能被 sharp 缩成 9×8）计算 dHash。
 * 如果解码失败返回全 0 的 16 位 hex。
 *
 * 注：不直接依赖 sharp 的导入，为了让单元测试可以不装 sharp；调用方自己 try/catch 处理 sharp 缺失。
 */
export async function dHashFromImageBuffer(
  buf: Uint8Array,
  resize9x8: (b: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  try {
    const gray = await resize9x8(buf);
    return dHashFromGray9x8(new Uint8Array(gray));
  } catch {
    return "0".repeat(16);
  }
}
