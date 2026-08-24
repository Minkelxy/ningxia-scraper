/**
 * tests/ingest-one.test.ts
 *
 * TR-3.1: fixture HTML 喂给解析器 → 字段齐全 (title/bodyHtml/images≥1/authorNickname 非空)
 * TR-3.2: nock mock CDN 返回 Content-Type:image/webp + 真实 webp magic bytes → 写出文件 magic bytes 合法
 * TR-3.3: MIME 非白名单 (text/html) → 图片下载失败，但 ingestQuality=partial，整体业务不挂 (exitCode 1 可接受)
 * TR-3.4: 同 noteId 两次 ingest → ndjson 只有 1 行
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import nock from "nock";
import { parseXhsHtml } from "../src/lib/html-parser.js";
import {
  detectImageMagic,
  downloadImage,
} from "../src/lib/image-downloader.js";
import { ingestFromHtml } from "../scripts/ingest-one.js";
import { readNdjson } from "../src/lib/storage.js";

function buildTmpRoot(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-ingest-test-"));
  return r;
}

// 最小合法 WebP 文件 (~30 bytes) RIFF....WEBPVP8 简单结构
function makeFakeWebpBytes(width: number, height: number): Buffer {
  // Build a real valid WebP "VP8L" lossless tiny 1x1 image would be complex.
  // Instead just ensure valid magic bytes + reasonable size.
  // For sniffing we need RIFF + size + WEBP.
  const sizePad = 32;
  const totalRiff = sizePad + 4 - 8;
  const buf = Buffer.alloc(sizePad);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(totalRiff, 4); // File size - 8
  buf.write("WEBP", 8);
  buf.write("VP8L", 12);
  buf.writeUInt32LE(1, 16); // chunk size
  // VP8L payload (5 bytes): 0x2f signature + 4 bits width-1, 4 bits height-1 ...
  // Simplified: not strictly valid but enough for magic bytes detection
  buf[20] = 0x2f;
  const w = width - 1;
  const h = height - 1;
  // 14 bits width LE, 14 bits height LE, 1 bit alpha=0, 1 bit version=0
  const bits = (w & 0x3fff) | ((h & 0x3fff) << 14);
  buf[21] = bits & 0xff;
  buf[22] = (bits >> 8) & 0xff;
  buf[23] = (bits >> 16) & 0xff;
  buf[24] = 0; // no more data
  void height;
  return buf;
}

describe("TR-3.1 · HTML Parser 解析 sample-note fixture", () => {
  it("抽取出的关键字段均非空", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "fixtures", "sample-note.html"),
      "utf8"
    );
    const p = parseXhsHtml(html);
    expect(p.noteId).toBe("abc123def456SAMPLE01");
    expect(p.title).toBeTruthy();
    expect(p.title).toContain("沙坡头");
    expect(p.authorNickname).toBe("宁夏小骆驼");
    expect(p.publishedAt).toBe("2025-06-15");
    expect(p.bodyPlainText!.length).toBeGreaterThan(50);
    expect(p.topics.length).toBeGreaterThanOrEqual(3);
    expect(p.topics).toContain("#中卫旅游");
    expect(p.topics).toContain("#沙坡头攻略");
    expect(p.imageUrls.length).toBeGreaterThanOrEqual(3);
    expect(p.imageUrls[0]!.url).toMatch(/^https:\/\//);
    expect(p.interaction.likeCount).toBe(2341);
    expect(p.interaction.collectCount).toBe(1890);
    expect(p.interaction.commentCount).toBe(126);
    expect(p.geoHint.cityName).toBe("中卫");
    expect(p.geoHint.attractionName).toBe("沙坡头旅游区");
    expect(p.geoHint.lat).toBe(37.52);
    expect(p.geoHint.lng).toBe(104.99);
    expect(p.sourceUrl).toBe("https://www.xiaohongshu.com/explore/abc123def456SAMPLE01");
  });
});

describe("Image downloader MIME + magic bytes guard", () => {
  beforeEach(() => {
    nock.cleanAll();
    nock.disableNetConnect();
  });
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("TR-3.2: Content-Type=image/webp + 真实 magic bytes → 成功下载，写出 Buffer magic bytes 正确", async () => {
    const webp = makeFakeWebpBytes(1080, 1440);
    nock("https://sns-img.xiaohongshu.com")
      .get(/\/img\/good-webp/)
      .reply(200, webp, { "Content-Type": "image/webp" });

    const r = await downloadImage("https://sns-img.xiaohongshu.com/img/good-webp", {
      minImageWidth: 50,
      retries: 0,
    });
    expect(r.detectedExt).toBe("webp");
    expect(detectImageMagic(r.buffer)).toBe("webp");
    expect(r.contentType).toBe("image/webp");
  });

  it("TR-3.3: 返回 Content-Type=text/html 冒充图片 → 立即拒绝，抛出不可重试错误", async () => {
    nock("https://sns-img.xiaohongshu.com")
      .get(/\/img\/bad-mime/)
      .reply(200, "<html>登录页</html>", { "Content-Type": "text/html; charset=utf-8" });

    await expect(
      downloadImage("https://sns-img.xiaohongshu.com/img/bad-mime", { retries: 0 })
    ).rejects.toThrow(/Content-Type/);
  });

  it("Content-Type 对 (image/webp) 但 magic bytes 不对 (实际是 HTML) → 被 magic bytes 拒绝", async () => {
    nock("https://sns-img.xiaohongshu.com")
      .get(/\/img\/fake-magic/)
      .reply(200, Buffer.from("<html>错误页</html>", "utf8"), {
        "Content-Type": "image/webp",
      });
    await expect(
      downloadImage("https://sns-img.xiaohongshu.com/img/fake-magic", { retries: 0 })
    ).rejects.toThrow(/magic bytes/);
  });
});

describe("ingestFromHtml end-to-end", () => {
  let tmp: string;
  const FIXTURE = path.join(__dirname, "fixtures", "sample-note.html");

  beforeEach(() => {
    tmp = buildTmpRoot();
    nock.cleanAll();
    nock.disableNetConnect();
    // 为 fixture 中 3 张 URL 准备 mock
    for (const p of ["sample-cover-001", "sample-002", "sample-003"]) {
      nock("https://sns-img.xiaohongshu.com")
        .get(new RegExp(`/img/${p}`))
        .reply(200, makeFakeWebpBytes(1080, 1440), { "Content-Type": "image/webp" });
    }
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("成功写入所有文件：raw json / ndjson 1 行 / index / provenance / 3 张图片", async () => {
    const r = await ingestFromHtml(FIXTURE, { root: tmp });
    expect(r.ok).toBe(true);
    expect(r.noteId).toBe("abc123def456SAMPLE01");
    expect(r.imagesDownloaded).toBe(3);
    expect(r.exitCode).toBe(0);

    // 文件存在性
    const rawJson = path.join(tmp, "data-raw", "json", "abc123def456SAMPLE01.json");
    expect(fs.existsSync(rawJson)).toBe(true);
    const note = JSON.parse(fs.readFileSync(rawJson, "utf8"));
    expect(note.images).toHaveLength(3);
    expect(note.source_id).toBe("xhs:abc123def456SAMPLE01");
    expect(note.license).toBeUndefined(); // 不在顶层，应该在每张图片下
    expect(note.images[0].license).toBe("for-reference-only");

    // ndjson 只有 1 行
    const ndjsonLines = fs
      .readFileSync(path.join(tmp, "data", "notes.ndjson"), "utf8")
      .trim()
      .split(/\n/)
      .filter(Boolean);
    expect(ndjsonLines).toHaveLength(1);

    // provenance CSV 包含 ACTIVE 行
    const csv = fs.readFileSync(path.join(tmp, "provenance", "manifest.csv"), "utf8");
    expect(csv).toContain("abc123def456SAMPLE01");
    expect(csv).toContain("ACTIVE");
    expect(csv).toContain("for-reference-only");

    // notes-index.json 有该 key
    const idx = JSON.parse(fs.readFileSync(path.join(tmp, "data", "notes-index.json"), "utf8"));
    expect(idx["abc123def456SAMPLE01"]).toBeTruthy();
    expect(idx["abc123def456SAMPLE01"].imageCount).toBe(3);

    // 图片 magic bytes 合法，非 HTML
    for (let i = 1; i <= 3; i++) {
      const p = path.join(
        tmp,
        "images",
        "full",
        "abc123def456SAMPLE01",
        `img-${String(i).padStart(3, "0")}.webp`
      );
      expect(fs.existsSync(p)).toBe(true);
      const bytes = fs.readFileSync(p);
      expect(detectImageMagic(bytes)).toBe("webp");
    }
  });

  it("TR-3.4: 同一 noteId 两次 ingest → ndjson 仍只有 1 行 (update, 不重复)", async () => {
    await ingestFromHtml(FIXTURE, { root: tmp });
    // 第二次
    await ingestFromHtml(FIXTURE, { root: tmp });

    const lines = fs
      .readFileSync(path.join(tmp, "data", "notes.ndjson"), "utf8")
      .trim()
      .split(/\n/)
      .filter(Boolean);
    expect(lines).toHaveLength(1);
    // 并且 Map 里只有一个
    const m = readNdjson(tmp);
    expect(m.size).toBe(1);
  });

  it("MIME 非白名单导致所有图片下载失败 → ingestQuality=partial，但正文可用时整体仍算成功 (exitCode 0)", async () => {
    // 清除默认的 nock 图片 mock，改用 3 个错误响应
    nock.cleanAll();
    for (const p of ["sample-cover-001", "sample-002", "sample-003"]) {
      nock("https://sns-img.xiaohongshu.com")
        .get(new RegExp(`/img/${p}`))
        .reply(200, "<html>WAF 拦截</html>", { "Content-Type": "text/html" });
    }
    const r = await ingestFromHtml(FIXTURE, { root: tmp });
    expect(r.quality).toBe("partial");
    expect(r.imagesDownloaded).toBe(0);
    // quality 降级但业务不挂：有正文 + provenance 齐全 = exitCode 0
    expect(r.exitCode).toBe(0);
    expect(r.fetchErrors.length).toBeGreaterThanOrEqual(3);
    // 但 notes 应该依然入库（只是 quality=partial，body 是有内容的）
    const raw = path.join(tmp, "data-raw", "json", "abc123def456SAMPLE01.json");
    expect(fs.existsSync(raw)).toBe(true);
  });

  it("--dry-run 不会真的写文件", async () => {
    const r = await ingestFromHtml(FIXTURE, { root: tmp, dryRun: true });
    expect(r.ok).toBe(true);
    // root 下应该没有任何数据文件写入
    const raw = path.join(tmp, "data-raw", "json", "abc123def456SAMPLE01.json");
    expect(fs.existsSync(raw)).toBe(false);
  });
});
