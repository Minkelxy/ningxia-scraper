/**
 * src/lib/weibo-parser.ts
 *
 * 从微博「另存为 HTML」中尽量抽取 FR-2 字段。
 * 策略：微博 DOM / JSON 结构多变，能抽就抽、抽不到置 null，绝不编造。
 *
 * 抽取优先级：
 *   1. <script> 内 window.$render_data / window.__INITIAL_STATE__ JSON 里的 status 对象
 *   2. <meta property="og:*">、<meta name="description">
 *   3. 可见 DOM 的宽松 class 选择器（fallback）
 *
 * 与 html-parser.ts 风格一致：私有 helper 自包含复制一份，避免跨模块抽象造成循环依赖。
 */

import * as cheerio from "cheerio";
import { toYYYYMMDD, type ParsedHtmlNote } from "./html-parser.js";

/**
 * 从微博另存 HTML 解析笔记。
 * @param html Raw HTML string（完整另存 HTML 或局部都行）
 * @param hintNoteId 调用方可提供 noteId；HTML 里找不到时兜底
 */
export function parseWeiboHtml(html: string, hintNoteId?: string): ParsedHtmlNote {
  const $ = cheerio.load(html);

  // ===== 先找 window.$render_data / window.__INITIAL_STATE__ =====
  let jsonStatus: Record<string, unknown> | null = null;
  $("script").each((_, el) => {
    if (jsonStatus) return;
    const txt = $(el).html() || "";
    for (const varName of ["$render_data", "__INITIAL_STATE__"]) {
      if (jsonStatus) break;
      const obj = extractAssignedJson(txt, varName);
      if (obj !== null) {
        const dug = digForWeibo(obj);
        if (dug) jsonStatus = dug;
      }
    }
  });

  const fromJson = <K extends string>(keys: K[]): unknown | null => {
    if (!jsonStatus) return null;
    for (const k of keys) {
      const v = (jsonStatus as Record<string, unknown>)[k];
      if (v !== undefined && v !== null) return v;
    }
    return null;
  };
  const jStr = (keys: string[]): string | null => {
    const v = fromJson(keys);
    return typeof v === "string" ? v : null;
  };
  const jNum = (keys: string[]): number | null => {
    const v = fromJson(keys);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  // ===== noteId（微博 id 是纯数字 mid / idstr，优先取字符串形式避免大整数丢精度） =====
  let noteId: string | null = null;
  const jId = fromJson(["idstr", "mid", "bid", "blogid", "id"]);
  if (typeof jId === "string") noteId = jId;
  else if (typeof jId === "number") noteId = String(jId);
  if (!noteId) {
    // 从 canonical / og:url 末段再试（纯数字 mid）
    const canonical = $("link[rel=canonical]").attr("href") || "";
    const ogUrl = $('meta[property="og:url"]').attr("content") || "";
    const m = (canonical || ogUrl).match(/(\d{6,})/);
    if (m && m[1]) noteId = m[1];
  }
  if (!noteId && hintNoteId) noteId = hintNoteId;

  // ===== authorNickname =====
  let authorNickname: string | null = null;
  const user = fromJson(["user"]);
  if (user && typeof user === "object") {
    const u = user as Record<string, unknown>;
    const nick = u.screen_name ?? u.name ?? u.nickname;
    if (typeof nick === "string") authorNickname = nick;
  }
  if (!authorNickname) {
    authorNickname =
      $('[class*="author"], [class*="name"]').first().text().trim() || null;
  }
  if (authorNickname) authorNickname = cleanText(authorNickname).slice(0, 64);
  if (!authorNickname) authorNickname = "未知作者";

  // ===== publishedAt =====
  let publishedAt: string | null = null;
  const ts = jNum(["created_at", "createdAt", "create_time"]);
  if (ts !== null) {
    try {
      const ms = ts > 1e12 ? ts : ts * 1000; // 秒级 vs 毫秒级
      publishedAt = toYYYYMMDD(new Date(ms));
    } catch { /* noop */ }
  }
  if (!publishedAt) {
    const dateText =
      $('meta[property="article:published_time"]').attr("content") ||
      $("body").text().match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/)?.[0] ||
      null;
    if (dateText) publishedAt = normalizeDate(dateText);
  }

  // ===== body（微博正文：JSON text/render 优先，text_raw 兜底，再 DOM） =====
  let bodyHtml: string | null = jStr(["text", "render"]) as string | null;
  if (!bodyHtml) {
    const raw = jStr(["text_raw", "textRaw", "raw_text"]);
    if (raw) bodyHtml = `<p>${escapeHtml(raw)}</p>`;
  }
  if (!bodyHtml) {
    const candidates = [
      '[class*="weibo-text"]',
      '[class*="detail-text"]',
      '[class*="content"]',
      "article",
      "main",
    ];
    for (const sel of candidates) {
      const $el = $(sel).first();
      if ($el.length && $el.text().trim().length >= 20) {
        bodyHtml = $el.html();
        break;
      }
    }
    if (!bodyHtml) {
      const md = $('meta[name="description"]').attr("content") ||
                 $('meta[property="og:description"]').attr("content");
      if (md) bodyHtml = `<p>${escapeHtml(md)}</p>`;
    }
  }
  const bodyPlainText = stripHtmlAndClean(bodyHtml).slice(0, 50_000);
  if (bodyHtml && bodyHtml.length > 50_000) bodyHtml = bodyHtml.slice(0, 50_000);

  // ===== title（微博无独立标题：og:title 优先，否则正文前 30 字 + …） =====
  let title: string | null = $('meta[property="og:title"]').attr("content") || null;
  if (!title && bodyPlainText) {
    title = bodyPlainText.slice(0, 30) + (bodyPlainText.length > 30 ? "…" : "");
  }
  if (title) title = cleanText(title);

  // ===== topics（微博话题是 #xxx# 双井号，归一成 #xxx） =====
  const topics = new Set<string>();
  const jTopics = fromJson(["topic_structures", "topics", "tagStructures"]);
  if (Array.isArray(jTopics)) {
    for (const t of jTopics) {
      if (typeof t === "string") {
        topics.add(normalizeTag(t));
      } else if (t && typeof t === "object") {
        const r = t as Record<string, unknown>;
        const name = r.topic_title ?? r.title ?? r.name ?? r.topic;
        if (typeof name === "string") topics.add(normalizeTag(name));
      }
    }
  }
  if (bodyPlainText) {
    const tagRe = /#([^#\s…]{1,30})#/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(bodyPlainText)) !== null) {
      if (m[1]) topics.add("#" + cleanTag(m[1]));
    }
  }

  // ===== imageUrls（pic_infos 优先，og:image / DOM <img> 兜底，仅收 https） =====
  const imageUrls: Array<{ url: string; caption?: string | null }> = [];
  const seenUrl = new Set<string>();
  const addImg = (u: string, caption?: string | null) => {
    if (!u) return;
    let url = u.trim();
    if (!url) return;
    if (url.startsWith("//")) url = "https:" + url;
    if (!url.startsWith("https://")) return;
    if (seenUrl.has(url)) return;
    seenUrl.add(url);
    imageUrls.push({ url, caption: caption ?? null });
  };
  const ogImg = $('meta[property="og:image"]').attr("content");
  if (ogImg) addImg(ogImg, null);
  const picInfos = fromJson(["pic_infos", "picInfo", "pics"]);
  if (picInfos && typeof picInfos === "object") {
    const iter: unknown[] = Array.isArray(picInfos)
      ? picInfos
      : Object.values(picInfos as Record<string, unknown>);
    for (const pic of iter) {
      const u = pickPicUrl(pic);
      if (u) addImg(u, null);
    }
  }
  const jImgs = fromJson(["images", "image_list", "imgs", "pic_large"]);
  if (Array.isArray(jImgs)) {
    for (const img of jImgs) {
      if (typeof img === "string") {
        addImg(img, null);
      } else if (img && typeof img === "object") {
        const u = pickPicUrl(img);
        if (u) addImg(u, null);
      }
    }
  }
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (!src) return;
    const w = Number($(el).attr("width") || 0);
    const h = Number($(el).attr("height") || 0);
    if (w && h && (w < 100 || h < 100)) return; // 过滤头像小图
    const alt = $(el).attr("alt")?.trim() || null;
    addImg(src, alt);
  });
  const trimmedImages = imageUrls.slice(0, 50);

  // ===== 互动数据（attitudes→赞，comments→评论，reposts→收藏近似） =====
  const likeCount = firstNum([
    jNum(["attitudes_count", "attitudesCount", "like_count"]),
    extractInt($('[class*="like"]').text()),
    extractInt($('[class*="attitude"]').text()),
  ]);
  const commentCount = firstNum([
    jNum(["comments_count", "commentsCount", "comment_count"]),
    extractInt($('[class*="comment"]').text()),
  ]);
  const collectCount = firstNum([
    jNum(["reposts_count", "repostsCount", "repost_count"]),
    extractInt($('[class*="repost"]').text()),
    extractInt($('[class*="forward"]').text()),
  ]);

  // ===== geoHint（region_name → 景点；正文命中宁夏 5 市 / 8 个 5A） =====
  const geoHint: ParsedHtmlNote["geoHint"] = {
    cityName: null,
    attractionName: null,
    lat: null,
    lng: null,
  };
  const regionName = jStr(["region_name", "regionName", "location"]);
  if (regionName) geoHint.attractionName = cleanText(regionName).slice(0, 64);
  const CITIES = ["银川", "石嘴山", "吴忠", "固原", "中卫"];
  const ATTRS = [
    "沙坡头", "沙湖", "镇北堡西部影城", "镇北堡", "水洞沟", "六盘山",
    "火石寨", "须弥山", "西夏陵", "西夏王陵",
  ];
  const allText = (title || "") + " " + (bodyPlainText || "");
  for (const c of CITIES) {
    if (allText.includes(c)) {
      geoHint.cityName = c;
      break;
    }
  }
  if (!geoHint.attractionName) {
    for (const a of ATTRS) {
      if (allText.includes(a)) {
        geoHint.attractionName = a;
        break;
      }
    }
  }
  const lat = jNum(["lat", "latitude"]);
  const lng = jNum(["lng", "longitude", "lon"]);
  if (lat !== null) geoHint.lat = lat;
  if (lng !== null) geoHint.lng = lng;

  // ===== sourceUrl =====
  let sourceUrl = jStr(["sourceUrl", "url", "scheme_url"]);
  if (!sourceUrl) {
    sourceUrl =
      $("link[rel=canonical]").attr("href") ||
      $('meta[property="og:url"]').attr("content") ||
      null;
  }
  if (!sourceUrl && noteId) {
    sourceUrl = `https://m.weibo.cn/detail/${noteId}`;
  }

  return {
    noteId,
    title,
    bodyHtml,
    bodyPlainText,
    authorNickname,
    publishedAt,
    topics: Array.from(topics),
    imageUrls: trimmedImages,
    sourceUrl,
    interaction: { likeCount, collectCount, commentCount },
    geoHint,
  };
}

// ===== Helpers =====

/** 定位 window.varName = ... 并按括号配平抽取 JSON 值（对象或数组均可，字符串内部括号安全）。 */
function extractAssignedJson(text: string, varName: string): unknown | null {
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`window\\.${escaped}\\s*=\\s*`);
  const m = re.exec(text);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  const ch0 = text[i];
  if (ch0 !== "{" && ch0 !== "[") return null;
  const start = i;
  let inStr = false;
  let esc = false;
  let depth = 0;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        const jsonStr = text.slice(start, i + 1);
        try { return JSON.parse(jsonStr); } catch { return null; }
      }
    }
  }
  return null;
}

/** 递归找「看起来像 weibo status 的对象」：含 text 类字段且含 pic_ids 或 id。 */
function digForWeibo(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const r = digForWeibo(it);
      if (r) return r;
    }
    return null;
  }
  const o = obj as Record<string, unknown>;
  const hasText =
    typeof o.text === "string" ||
    typeof o.text_raw === "string" ||
    typeof o.render === "string";
  const hasPicOrId =
    Array.isArray(o.pic_ids) ||
    (o.pic_infos !== undefined && o.pic_infos !== null) ||
    o.id !== undefined;
  if (hasText && hasPicOrId) return o;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === "object") {
      const r = digForWeibo(v);
      if (r) return r;
    }
  }
  return null;
}

/** 从微博 pic_infos 单个图对象里取 url（large/original/url 等多种结构）。 */
function pickPicUrl(pic: unknown): string | null {
  if (!pic || typeof pic !== "object") return null;
  const r = pic as Record<string, unknown>;
  const nests = ["large", "original", "largest", "bmiddle", "middle", "pic_big", "pic_mid", "pic_small"];
  for (const k of nests) {
    const v = r[k];
    if (v && typeof v === "object") {
      const u = (v as Record<string, unknown>).url;
      if (typeof u === "string") return u;
    }
  }
  const directs = ["url", "pic_url", "originalUrl", "pic_big", "bmiddle_pic", "pic_src"];
  for (const k of directs) {
    const v = r[k];
    if (typeof v === "string") return v;
  }
  return null;
}

function cleanText(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripHtmlAndClean(html: string | null): string {
  if (!html) return "";
  const $ = cheerio.load(html);
  let text = $.root().text();
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return cleanText(text);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstNum(arr: Array<number | null>): number | null {
  for (const n of arr) {
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/** 从「1.2万」「350」「2k」等字符串尽量解析一个正整数 */
function extractInt(s: string | undefined | null): number | null {
  if (!s) return null;
  const text = s.replace(/[,，\s]/g, "");
  let m = text.match(/([\d.]+)\s*万/);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return Math.round(n * 10_000);
  }
  m = text.match(/([\d.]+)\s*[kK]/);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return Math.round(n * 1_000);
  }
  m = text.match(/(\d{1,7})/);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeDate(s: string): string | null {
  const m = s.match(/(20\d{2})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return toYYYYMMDD(new Date(Date.UTC(y, mo - 1, d)));
}

function normalizeTag(s: string): string {
  const t = cleanTag(s.replace(/^#+/, "").replace(/#+$/, ""));
  return t ? "#" + t : "";
}

function cleanTag(s: string): string {
  return s.replace(/\s+/g, "").replace(/[，。,.!?！？;；:："'【】\[\]<>()（）]/g, "").slice(0, 30);
}
