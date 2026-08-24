/**
 * src/lib/ctrip-parser.ts
 *
 * 从携程 you.ctrip.com 游记另存 HTML 中尽量抽取 FR-2 字段。
 * 策略：携程页面结构变动大，所以「能抽就抽、抽不到就返回 null」，绝不编造。
 *
 * 抽取优先级：
 *   1. <script> 内 window.pageInfo / window.__INITIAL_STATE__ JSON 里的游记对象
 *   2. <meta property="og:*">、<link rel="canonical">
 *   3. 可见 DOM 的宽松 class 选择器（fallback）
 *
 * 返回 ParsedHtmlNote：字段都 nullable，由 ingest-one 再做兜底和质量分级。
 * 本 parser 自包含私有 helper，不跨模块抽私有函数，避免循环依赖。
 */

import * as cheerio from "cheerio";
import { toYYYYMMDD, type ParsedHtmlNote } from "./html-parser.js";

/**
 * 从携程游记 HTML 解析笔记。
 * @param html Raw HTML string（完整另存 HTML 或局部都行）
 * @param hintNoteId 调用方可提供 noteId；HTML 里找不到就用这个
 */
export function parseCtripHtml(html: string, hintNoteId?: string): ParsedHtmlNote {
  const $ = cheerio.load(html);

  // ===== 先找 window.pageInfo / window.__INITIAL_STATE__ 里的游记对象 =====
  let jsonNote: Record<string, unknown> | null = null;
  $("script").each((_, el) => {
    if (jsonNote) return;
    const txt = $(el).html() || "";
    let m = txt.match(/window\.pageInfo\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/m);
    if (!m) m = txt.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/m);
    if (m) {
      const g = m[1];
      if (g) {
        try {
          const obj = JSON.parse(g);
          jsonNote = digForTravel(obj);
        } catch { /* noop */ }
      }
    }
  });

  const fromJson = (keys: string[]): unknown => {
    if (!jsonNote) return null;
    for (const k of keys) {
      const v = (jsonNote as Record<string, unknown>)[k];
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

  // ===== noteId =====
  let noteId: string | null = null;
  const canonical = $("link[rel=canonical]").attr("href") || "";
  const ogUrl = $('meta[property="og:url"]').attr("content") || "";
  const u = canonical || ogUrl;
  if (u) {
    const m = u.match(/(?:travelogs|travelblogs|travels)\/(\d+)/i);
    if (m) {
      const g = m[1];
      if (g) noteId = g;
    }
  }
  if (!noteId) {
    const idv = fromJson(["Id", "TravelId", "PublishId", "NoteId", "noteId"]);
    if (typeof idv === "string") noteId = idv;
    else if (typeof idv === "number" && Number.isFinite(idv)) noteId = String(idv);
  }
  if (!noteId && hintNoteId) noteId = hintNoteId;

  // ===== title =====
  let title: string | null = $('meta[property="og:title"]').attr("content") || null;
  if (!title) title = $("title").text().trim() || null;
  if (!title) title = jStr(["title", "Title", "PublishTitle", "Publishtitle"]);
  if (title) title = cleanText(title);

  // ===== authorNickname =====
  let authorNickname = jStr(["Author", "User", "author", "nickName", "nickname", "userName"]);
  if (!authorNickname) {
    authorNickname =
      $('[class*="author"], [class*="nickname"], [class*="username"]').first().text().trim() || null;
  }
  if (authorNickname) authorNickname = cleanText(authorNickname).slice(0, 64);
  if (!authorNickname) authorNickname = "未知作者"; // 最后兜底，保证非空

  // ===== publishedAt =====
  let publishedAt: string | null = null;
  const apd = $('meta[property="article:published_time"]').attr("content");
  if (apd) publishedAt = normalizeDate(apd);
  if (!publishedAt) {
    const pd = jStr(["PublishDate", "PublishTime", "DateType", "publishDate", "publishTime"]);
    if (pd) publishedAt = normalizeDate(pd);
  }
  if (!publishedAt) {
    const bodyDate = $("body").text().match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/)?.[0];
    if (bodyDate) publishedAt = normalizeDate(bodyDate);
  }

  // ===== body =====
  let bodyHtml: string | null = jStr(["Content", "ContentBody", "content", "body", "Description"]);
  if (!bodyHtml) {
    const candidates = [
      '[class*="ctd_content"]',
      '[class*="NormalWords"]',
      '[id*="ctd_content"]',
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
  }
  const bodyPlainText = stripHtmlAndClean(bodyHtml).slice(0, 50_000);
  if (bodyHtml && bodyHtml.length > 50_000) bodyHtml = bodyHtml.slice(0, 50_000);

  // ===== topics（#话题# / 标签） =====
  const topics = new Set<string>();
  const jTags = fromJson(["Tags", "KeyWord", "Topic", "tags", "keywords", "tagList"]);
  if (Array.isArray(jTags)) {
    for (const t of jTags) {
      if (typeof t === "string") topics.add(normalizeTag(t));
      else if (t && typeof t === "object" && "name" in t)
        topics.add(normalizeTag(String((t as { name: unknown }).name)));
    }
  }
  if (bodyPlainText) {
    const tagRe = /#([^#\s…]{1,30})#/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(bodyPlainText)) !== null) {
      const g = m[1];
      if (g) topics.add("#" + cleanTag(g));
    }
  }

  // ===== imageUrls =====
  const imageUrls: Array<{ url: string; caption?: string | null }> = [];
  const seenUrl = new Set<string>();
  const addImg = (u: string, caption?: string | null) => {
    if (!u) return;
    let url = u.trim();
    if (!url) return;
    if (url.startsWith("//")) url = "https:" + url;
    if (!url.startsWith("https://")) return; // NFR-4 只允许 https
    if (seenUrl.has(url)) return;
    seenUrl.add(url);
    imageUrls.push({ url, caption: caption ?? null });
  };
  const ogImg = $('meta[property="og:image"]').attr("content");
  if (ogImg) addImg(ogImg, null);
  const jImgs = fromJson(["ImageList", "Images", "imageList", "imgs", "ImageUrls"]);
  if (Array.isArray(jImgs)) {
    for (const img of jImgs) {
      if (typeof img === "string") addImg(img);
      else if (img && typeof img === "object") {
        const r = img as Record<string, unknown>;
        const iu = r.url || r.Url || r.imageUrl || r.src;
        const cap = r.caption ?? r.Caption ?? r.title ?? r.desc ?? null;
        if (typeof iu === "string") addImg(iu, typeof cap === "string" ? cap : null);
      }
    }
  }
  const coverUrl = jStr(["CoverImageUrl", "CoverImage", "coverUrl", "cover_image"]);
  if (coverUrl) addImg(coverUrl, null);
  // 兜底：DOM 里所有 <img>（过滤明显头像/广告小图）
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-original-src") || "";
    if (!src) return;
    const w = Number($(el).attr("width") || 0);
    const h = Number($(el).attr("height") || 0);
    if (w && h && (w < 100 || h < 100)) return;
    const alt = $(el).attr("alt")?.trim() || null;
    addImg(src, alt);
  });
  const trimmedImages = imageUrls.slice(0, 50);

  // ===== 互动数据 =====
  const likeCount = firstNum([
    jNum(["LikeCount", "likeCount", "likes", "likedCount"]),
    extractInt($('[class*="like"]').text()),
    extractInt($('[class*="praise"]').text()),
  ]);
  const collectCount = firstNum([
    jNum(["FavCount", "collectCount", "CollectCount", "favCount", "collectedCount"]),
    extractInt($('[class*="collect"]').text()),
    extractInt($('[class*="fav"]').text()),
  ]);
  const commentCount = firstNum([
    jNum(["CommentCount", "commentCount", "comments"]),
    extractInt($('[class*="comment"]').text()),
  ]);

  // ===== geoHint =====
  const geoHint: ParsedHtmlNote["geoHint"] = {
    cityName: null,
    attractionName: null,
    lat: null,
    lng: null,
  };
  const loc = fromJson(["Location", "location", "loc"]);
  if (loc && typeof loc === "object") {
    const r = loc as Record<string, unknown>;
    const name =
      typeof r.name === "string" ? r.name :
      typeof r.attractionName === "string" ? r.attractionName :
      typeof r.address === "string" ? r.address : null;
    if (name) geoHint.attractionName = name;
    const lat = typeof r.lat === "number" ? r.lat : typeof r.latitude === "number" ? r.latitude : null;
    const lng = typeof r.lng === "number" ? r.lng : typeof r.longitude === "number" ? r.longitude : null;
    if (lat !== null && Number.isFinite(lat)) geoHint.lat = lat;
    if (lng !== null && Number.isFinite(lng)) geoHint.lng = lng;
  }
  if (!geoHint.cityName) {
    const dep = jStr(["DepartureCity", "departureCity", "CityName", "cityName", "city"]);
    if (dep) geoHint.cityName = dep;
  }
  if (!geoHint.cityName) {
    const dests = fromJson(["Destinations", "destinations", "DestinationList"]);
    if (Array.isArray(dests)) {
      for (const d of dests) {
        if (typeof d === "string") {
          geoHint.cityName = d;
          break;
        } else if (d && typeof d === "object" && "name" in d) {
          const nm = (d as { name: unknown }).name;
          if (typeof nm === "string") {
            geoHint.cityName = nm;
            break;
          }
        }
      }
    }
  }
  // 正文 / 标题里命中宁夏 5 市 / 8 个 5A（兜底）
  const CITIES = ["银川", "石嘴山", "吴忠", "固原", "中卫"];
  const ATTRS = [
    "沙坡头", "沙湖", "镇北堡西部影城", "镇北堡", "水洞沟", "六盘山",
    "火石寨", "须弥山", "西夏陵", "西夏王陵",
  ];
  const allText = (title || "") + " " + (bodyPlainText || "");
  if (!geoHint.cityName) {
    for (const c of CITIES) {
      if (allText.includes(c)) {
        geoHint.cityName = c;
        break;
      }
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

  // ===== sourceUrl =====
  let sourceUrl = jStr(["Url", "url", "SourceUrl", "sourceUrl"]);
  if (!sourceUrl) sourceUrl = $("link[rel=canonical]").attr("href") || null;
  if (!sourceUrl) sourceUrl = $('meta[property="og:url"]').attr("content") || null;
  if (!sourceUrl && noteId) sourceUrl = `https://you.ctrip.com/TravelBlogs/${noteId}.html`;

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

/** 从任意对象中深度查找「看起来像携程游记的对象」（有 PublishTitle/Content/Title 且有 Id/TravelId） */
function digForTravel(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const hasBody =
    typeof o.PublishTitle === "string" ||
    typeof o.Content === "string" ||
    typeof o.Title === "string" ||
    typeof o.ContentBody === "string";
  const hasId =
    typeof o.Id === "string" || typeof o.Id === "number" ||
    typeof o.TravelId === "string" || typeof o.TravelId === "number" ||
    typeof o.PublishId === "string" || typeof o.PublishId === "number";
  if (hasBody && hasId) return o;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === "object") {
      const inner = digForTravel(v);
      if (inner) return inner;
    }
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

function firstNum(arr: Array<number | null>): number | null {
  for (const n of arr) {
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/** 从「1.2万」「350」「点赞 2k」等字符串尽量解析一个正整数 */
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
  // s 可能是 2025-01-02 / 2025/1/2 / 2025年1月2日 / 2025-01-02T10:00:00+08:00
  const m = s.match(/(20\d{2})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return toYYYYMMDD(new Date(Date.UTC(y, mo - 1, d)));
}

function normalizeTag(s: string): string {
  const t = cleanTag(s.replace(/^#+/, ""));
  return t ? "#" + t : "";
}

function cleanTag(s: string): string {
  return s.replace(/\s+/g, "").replace(/[，。,.!?！？;；:："'【】\[\]<>()（）]/g, "").slice(0, 30);
}
