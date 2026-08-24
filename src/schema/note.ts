/**
 * XHS 笔记标准化 Zod Schema (对应 spec FR-2)
 *
 * 设计原则：
 * - 尽量严格：license 只能是 for-reference-only，sourcePlatform 固定 xhs。
 * - provenance 相关字段 (fetchedAt, sourceUrl, authorNickname) 非空。
 * - 允许抽取失败的字段置 null，但不允许类型错误。
 * - images[].sha256 / originalUrl / localPath / license 必须齐全，不允许缺。
 * - dedupeSignatures 的三个签名不能为空字符串（空的话 dedupe 没法用，应该是 ingest 失败）。
 */

import { z } from "zod";

// ===== Enums =====
export const LICENSE = "for-reference-only" as const;
export const SOURCE_PLATFORM = "xhs" as const;
export const VERIFICATION_HINT = "reported" as const;
export const INGEST_QUALITIES = ["full", "partial", "images-only"] as const;

// ===== Image Asset =====
export const ImageAssetSchema = z.object({
  sha256: z
    .string()
    .min(1, "sha256 不能为空")
    .regex(/^[a-f0-9]{64}$/i, "sha256 格式非法，应为 64 位 hex"),
  originalUrl: z
    .string()
    .min(1, "originalUrl 不能为空")
    .url("originalUrl 必须是合法 URL")
    .refine((u) => u.startsWith("https://"), "图片 originalUrl 必须走 https"),
  localPath: z.string().min(1, "localPath 不能为空"),
  width: z.number().int().positive("width 必须正整数").nullable(),
  height: z.number().int().positive("height 必须正整数").nullable(),
  captionFromNote: z.string().nullable().default(null),
  license: z.literal(LICENSE, {
    errorMap: () => ({ message: "图片 license 只能是 'for-reference-only'" }),
  }),
});
export type ImageAsset = z.infer<typeof ImageAssetSchema>;

// ===== Geo Hint =====
export const GeoHintSchema = z.object({
  cityName: z.string().nullable().default(null),
  attractionName: z.string().nullable().default(null),
  lat: z.number().finite().nullable().default(null),
  lng: z.number().finite().nullable().default(null),
});
export type GeoHint = z.infer<typeof GeoHintSchema>;

// ===== Dedupe Signatures =====
export const DedupeSignaturesSchema = z.object({
  titleMd5: z
    .string()
    .min(1, "titleMd5 不能为空")
    .regex(/^[a-f0-9]{32}$/i, "titleMd5 应为 32 位 hex，或者空串不行")
    .or(z.string().length(32).regex(/^[a-f0-9]{32}$/i)),
  bodySimhash: z
    .string()
    .min(1, "bodySimhash 不能为空")
    .regex(/^[a-f0-9]{16}$/i, "bodySimhash 应为 16 位 hex (64-bit)"),
  firstImagePerceptualHash: z.array(z.string()).default([]),
});
export type DedupeSignatures = z.infer<typeof DedupeSignaturesSchema>;

// ===== Remove Requested =====
export const RemoveRequestedSchema = z.union([
  z.literal(false),
  z.object({
    reason: z.string().min(1, "下架原因不能为空"),
    requestedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "requestedAt 格式 YYYY-MM-DD"),
    requester: z.string().min(1, "下架请求人不能为空"),
  }),
]);
export type RemoveRequested = z.infer<typeof RemoveRequestedSchema>;

// ===== Fetch Meta (仅运行时 & 调试字段，Zod 可选) =====
export const FetchMetaSchema = z
  .object({
    fetchErrors: z.array(z.string()).default([]),
    suspectedDuplicateOf: z.array(z.string()).default([]),
    retryCount: z.number().int().nonnegative().default(0),
    ingestMode: z.enum(["html", "url"]).nullable().default(null),
  })
  .default({});
export type FetchMeta = z.infer<typeof FetchMetaSchema>;

// ===== 主 Schema =====
export const XhsNoteSchema = z.object({
  noteId: z
    .string()
    .min(1, "noteId 不能为空")
    .regex(/^[A-Za-z0-9_-]+$/, "noteId 仅允许 URL safe 字符"),
  source_id: z.string().min(1, "source_id 不能为空"),
  fetchedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "fetchedAt 必须是 YYYY-MM-DD (Asia/Shanghai)"),
  sourceUrl: z
    .string()
    .min(1, "sourceUrl 不能为空")
    .url("sourceUrl 必须是合法 URL")
    .refine(
      (u) => /^https:\/\/(www\.)?xiaohongshu\.com\//i.test(u),
      "sourceUrl 必须是 xiaohongshu.com 的 https 链接"
    ),
  sourcePlatform: z.literal(SOURCE_PLATFORM, {
    errorMap: () => ({ message: "sourcePlatform 只能是 'xhs'" }),
  }),
  authorNickname: z
    .string()
    .min(1, "authorNickname 不能为空；至少有展示级昵称")
    .max(64, "authorNickname 超过 64 字符；如果是 HTML 片段，可能解析错了"),
  title: z.string().nullable().default(null),
  bodyHtml: z.string().max(50_000, "bodyHtml 截断到 5 万字").nullable().default(null),
  bodyPlainText: z
    .string()
    .max(50_000, "bodyPlainText 截断到 5 万字")
    .nullable()
    .default(null),
  publishedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "publishedAt 格式 YYYY-MM-DD 或 null")
    .nullable()
    .default(null),
  topics: z.array(z.string()).default([]),
  geoHint: GeoHintSchema.default({}),
  likeCount: z.number().int().nonnegative().nullable().default(null),
  collectCount: z.number().int().nonnegative().nullable().default(null),
  commentCount: z.number().int().nonnegative().nullable().default(null),
  images: z.array(ImageAssetSchema).default([]),
  ingestQuality: z.enum(INGEST_QUALITIES).default("partial"),
  verificationLevelHint: z.literal(VERIFICATION_HINT, {
    errorMap: () => ({
      message: "verificationLevelHint 只能是 'reported'（素材库级别，不是 verified）",
    }),
  }),
  dedupeSignatures: DedupeSignaturesSchema,
  removeRequested: RemoveRequestedSchema.default(false),
  _meta: FetchMetaSchema.default({}),
});

export type XhsNote = z.infer<typeof XhsNoteSchema>;

// ===== Helper：生成 source_id =====
export const makeSourceId = (noteId: string) => `${SOURCE_PLATFORM}:${noteId}`;
