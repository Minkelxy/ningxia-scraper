/**
 * src/lib/html-parser.ts
 *
 * 从 XHS 笔记的另存 HTML 中尽量抽取 FR-2 字段。
 * 策略：XHS DOM 随时会变，所以「能抽就抽、抽不到就返回 null」，绝不编造。
 *
 * 抽取优先级：
 *   1. <script id="__NEXT_DATA__"> 或 window.__INITIAL_STATE__ JSON 里的 note 对象
 *   2. <meta property="og:title">、<meta property="og:image">、<meta name="description">
 *   3. 可见 DOM 的 class 选择器（fallback，尽量宽松）
 *
 * 返回 ParsedNote：字段都 nullable，由 ingest-one 再做兜底和质量分级。
 */

import * as cheerio from "cheerio";
import { md5 } from "./hashes.js";
import { parseWeiboHtml } from "./weibo-parser.js";
import { parseCtripHtml } from "./ctrip-parser.js";
import { type Platform } from "../schema/note.js";

export type ParsedHtmlNote = {
  noteId: string | null;
  title: string | null;
  bodyHtml: string | null;
  bodyPlainText: string | null;
  authorNickname: string | null;
  publishedAt: string | null; // YYYY-MM-DD 或 null
  topics: string[];
  imageUrls: Array<{ url: string; caption?: string | null }>;
  sourceUrl: string | null; // 从 og:url 或 <link rel="canonical"> 取
  interaction: {
    likeCount: number | null;
    collectCount: number | null;
    commentCount: number | null;
  };
  geoHint: {
    cityName: string | null;
    attractionName: string | null;
    lat: number | null;
    lng: number | null;
  };
};

/**
 * 从 HTML 解析笔记。
 * @param html Raw HTML string (完整另存 HTML 或局部都行)
 * @param hintNoteId 调用方可提供 noteId；如果 HTML 里找不到就用这个
 */
export function parseXhsHtml(html: string, hintNoteId?: string): ParsedHtmlNote {
  const $ = cheerio.load(html);

  // ===== 先找 __NEXT_DATA__ / __INITIAL_STATE__ =====
  let jsonNote: Record<string, unknown> | null = null;
  const $next = $("#__NEXT_DATA__");
  if ($next.length) {
    try {
      const obj = JSON.parse($next.text() || "{}");
      jsonNote = digForNote(obj);
    } catch { /* noop */ }
  }
  if (!jsonNote) {
    $("script").each((_, el) => {
      if (jsonNote) return;
      const txt = $(el).html() || "";
      const m = txt.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*$/m);
      if (m) {
        try {
          const obj = JSON.parse(m[1]!);
          jsonNote = digForNote(obj);
        } catch { /* noop */ }
      }
    });
  }

  const fromJson = <K extends string>(keys: K[]): unknown | null => {
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
  let noteId: string | null = jStr(["noteId", "id", "note_id"]);
  if (!noteId && hintNoteId) noteId = hintNoteId;
  // 从 canonical / og:url 路径再试
  if (!noteId) {
    const canonical = $("link[rel=canonical]").attr("href") || "";
    const ogUrl = $('meta[property="og:url"]').attr("content") || "";
    const u = canonical || ogUrl;
    const m = u.match(/\/explore\/([A-Za-z0-9_-]+)/);
    if (m && m[1]) noteId = m[1];
  }

  // ===== title =====
  let title: string | null = jStr(["title", "displayTitle", "note_title"]);
  if (!title) title = $('meta[property="og:title"]').attr("content") || null;
  if (!title) title = $("title").text().trim() || null;
  if (title) title = cleanText(title);

  // ===== authorNickname =====
  let authorNickname = jStr(["nickname", "userNickname", "author", "nickName", "user_name"]);
  if (!authorNickname) {
    // 从页面中找 class 包含 nickname / author / user-name 的元素文本，取第一个非空
    authorNickname =
      $(
        '[class*="nickname"], [class*="author-name"], [class*="user-name"], [class*="username"]'
      )
        .first()
        .text()
        .trim() || null;
  }
  if (authorNickname) authorNickname = cleanText(authorNickname).slice(0, 64);
  if (!authorNickname) authorNickname = "未知作者"; // 最后兜底，保证 Schema 非空

  // ===== publishedAt =====
  let publishedAt: string | null = null;
  const ts = jNum(["time", "publishTime", "publish_time", "created", "createdAt", "ts"]);
  if (ts !== null) {
    try {
      const ms = ts > 1e12 ? ts : ts * 1000;
      publishedAt = toYYYYMMDD(new Date(ms));
    } catch { /* noop */ }
  }
  if (!publishedAt) {
    // 找包含日期格式 2025-xx-xx 或 xxxx年xx月xx日的文本
    const dateText =
      $('meta[property="article:published_time"]').attr("content") ||
      $("body").text().match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/)?.[0] ||
      null;
    if (dateText) publishedAt = normalizeDate(dateText);
  }

  // ===== body =====
  let bodyHtml: string | null = jStr(["content", "desc", "description", "body", "noteContent"]) as string | null;
  let bodyPlainText: string | null;
  if (!bodyHtml) {
    // 从可见容器取
    const candidates = [
      "#detail-desc",
      '[class*="note-content"]',
      '[class*="note-desc"]',
      '[class*="content"] [class*="desc"]',
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
    // 再兜底：meta description
    if (!bodyHtml) {
      const md = $('meta[name="description"]').attr("content") ||
                 $('meta[property="og:description"]').attr("content");
      if (md) bodyHtml = `<p>${escapeHtml(md)}</p>`;
    }
  }
  bodyPlainText = stripHtmlAndClean(bodyHtml).slice(0, 50_000);
  if (bodyHtml && bodyHtml.length > 50_000) bodyHtml = bodyHtml.slice(0, 50_000);

  // ===== topics（话题标签） =====
  const topics = new Set<string>();
  // 1. JSON 里的 tags / topics
  const jTags = fromJson(["tags", "topics", "tagList", "hashTags", "atags"]);
  if (Array.isArray(jTags)) {
    for (const t of jTags) {
      if (typeof t === "string") topics.add(normalizeTag(t));
      else if (t && typeof t === "object" && "name" in t) topics.add(normalizeTag(String((t as { name: unknown }).name)));
    }
  }
  // 2. body 里的 #xxx 形式（正文中的话题）
  if (bodyPlainText) {
    const tagRe = /#([^#\s\n\r【】\[\]<>]{1,30})(?=\s|#|$|[，。！？,?!；;])/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(bodyPlainText)) !== null) {
      if (m[1]) topics.add("#" + cleanTag(m[1]));
    }
  }

  // ===== imageUrls =====
  const imageUrls: Array<{ url: string; caption?: string | null }> = [];
  const seenUrl = new Set<string>();
  const addImg = (u: string, caption?: string | null) => {
    if (!u) return;
    let url = u.trim();
    if (!url) return;
    // XHS 有些图 URL 是 protocol-relative: //sns-img.xiaohongshu.com/...
    if (url.startsWith("//")) url = "https:" + url;
    if (!url.startsWith("https://")) return; // NFR-4 只允许 https
    // 去掉签名参数？不需要，存原始 URL 作为 provenance
    if (seenUrl.has(url)) return;
    seenUrl.add(url);
    // 过滤头像小图：尺寸线索看 URL 里有 w/h；没线索先收下，后面下载层会判断宽高
    imageUrls.push({ url, caption: caption ?? null });
  };
  // og:image
  const ogImg = $('meta[property="og:image"]').attr("content");
  if (ogImg) addImg(ogImg, null);
  // JSON 里的 images
  const jImgs = fromJson(["images", "imageList", "image_list", "imgs"]);
  if (Array.isArray(jImgs)) {
    for (const img of jImgs) {
      if (typeof img === "string") addImg(img);
      else if (img && typeof img === "object") {
        const r = img as Record<string, unknown>;
        const u = r.url || r.urlDefault || r.url_pre || r.urlPre || r.src;
        const cap = r.caption ?? r.title ?? r.desc ?? null;
        if (typeof u === "string") {
          addImg(u, typeof cap === "string" ? cap : null);
        }
      }
    }
  }
  // 兜底：DOM 里所有 <img>
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-original-src") || "";
    if (!src) return;
    const w = Number($(el).attr("width") || 0);
    const h = Number($(el).attr("height") || 0);
    // 过滤明显头像 / 广告小图（都没宽高属性的先收下，下载后再判断）
    if (w && h && (w < 100 || h < 100)) return;
    const alt = $(el).attr("alt")?.trim() || null;
    addImg(src, alt);
  });
  // 限制最多 50 张
  const trimmedImages = imageUrls.slice(0, 50);

  // ===== 互动数据 =====
  const likeCount = firstNum([
    jNum(["likedCount", "likeCount", "likes", "liked_count"]),
    extractInt($('[class*="like"]').text()),
    extractInt($('[class*="praise"]').text()),
  ]);
  const collectCount = firstNum([
    jNum(["collectedCount", "collectCount", "collects", "favCount"]),
    extractInt($('[class*="collect"]').text()),
    extractInt($('[class*="star"]').text()),
    extractInt($('[class*="fav"]').text()),
  ]);
  const commentCount = firstNum([
    jNum(["commentCount", "commentsCount", "comments"]),
    extractInt($('[class*="comment"]').text()),
  ]);

  // ===== geoHint =====
  const geoHint: ParsedHtmlNote["geoHint"] = {
    cityName: null,
    attractionName: null,
    lat: null,
    lng: null,
  };
  const loc = fromJson(["location", "geo", "address", "loc"]);
  if (loc && typeof loc === "object") {
    const r = loc as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : (typeof r.address === "string" ? r.address : null);
    if (name) geoHint.attractionName = name;
    const lat = typeof r.lat === "number" ? r.lat : (typeof r.latitude === "number" ? r.latitude : null);
    const lng = typeof r.lng === "number" ? r.lng : (typeof r.longitude === "number" ? r.longitude : null);
    if (Number.isFinite(lat)) geoHint.lat = lat as number;
    if (Number.isFinite(lng)) geoHint.lng = lng as number;
  }
  // 正文里找 5 市 / 8 个 5A 的命中（粗略）
  const CITIES = ["银川", "石嘴山", "吴忠", "固原", "中卫"];
  const ATTRS = [
    "沙坡头", "沙湖", "镇北堡西部影城", "镇北堡", "水洞沟", "六盘山",
    "火石寨", "须弥山", "西夏陵", "西夏王陵",
  ];
  const allText = (title || "") + " " + (bodyPlainText || "");
  for (const c of CITIES) {
    if (allText.includes(c)) {
      geoHint.cityName = c; // 命中多个就取第一个吧，只是 geoHint，不强求
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

  // ===== sourceUrl =====
  let sourceUrl = jStr(["sourceUrl", "url"]);
  if (!sourceUrl) {
    sourceUrl =
      $("link[rel=canonical]").attr("href") ||
      $('meta[property="og:url"]').attr("content") ||
      null;
  }
  if (!sourceUrl && noteId) {
    sourceUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
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

/** 从任意对象中深度查找「看起来像 note 的对象」（有 title 且有 images 或 content 字段） */
function digForNote(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  // 目标：有 noteId 或 id，加上 content/images/title 之一
  const hasId = typeof o.noteId === "string" || typeof o.id === "string";
  const hasBody =
    typeof o.content === "string" ||
    typeof o.title === "string" ||
    typeof o.desc === "string" ||
    Array.isArray(o.images);
  if (hasId && hasBody) return o;

  // 递归查找常见键
  const paths = ["note", "noteDetail", "noteDetailMap", "noteMap", "noteView", "data", "props", "pageProps"];
  for (const k of paths) {
    if (o[k] && typeof o[k] === "object") {
      const inner = digForNote(o[k]);
      if (inner) return inner;
      // 如果对象是个 Map<string, note>，尝试每个值
      const mapLike = o[k] as Record<string, unknown>;
      for (const mk of Object.keys(mapLike)) {
        const mv = mapLike[mk];
        const r = digForNote(mv);
        if (r) return r;
      }
    }
  }
  return null;
}

function cleanText(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripHtmlAndClean(html: string | null): string {
  if (!html) return "";
  // 用 cheerio 去 HTML，避免正则遗漏
  const $ = cheerio.load(html);
  let text = $.root().text();
  // 把 emoji 保留（"⭐️推荐" 这种有用），只去不可控控制字符
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

/** 从「1.2万」「350」「点赞 2k」等字符串尽量解析一个正整数 */
function extractInt(s: string | undefined | null): number | null {
  if (!s) return null;
  const text = s.replace(/[,，\s]/g, "");
  // 2.3万 → 23000
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
  // s 可能是 2025-01-02 / 2025/1/2 / 2025年1月2日
  const m = s.match(/(20\d{2})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return toYYYYMMDD(new Date(Date.UTC(y, mo - 1, d)));
}

export function toYYYYMMDD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeTag(s: string): string {
  const t = cleanTag(s.replace(/^#+/, ""));
  return t ? "#" + t : "";
}

function cleanTag(s: string): string {
  return s.replace(/\s+/g, "").replace(/[，。,.!?！？;；:："'【】\[\]<>()（）]/g, "").slice(0, 30);
}

// 导出 md5 给其他模块复用
export { md5 };

// parseHtml 是新的统一调度入口：按 platform 分派到对应平台 parser；
// 原 parseXhsHtml 保持不动，维持向后兼容。

/**
 * 嗅探 HTML 来源平台（xhs / weibo / ctrip），无法识别返回 null。
 * 规则按命中先后，返回第一个匹配；在小写化后的文本里查子串，避免大正则。
 */
export function sniffPlatform(html: string): Platform | null {
  const t = html.toLowerCase();
  // xhs: xiaohongshu.com，或 __NEXT_DATA__ 且 noteDetailMap
  if (t.includes("xiaohongshu.com")) return "xhs";
  if (t.includes("__next_data__") && t.includes("notedetailmap")) return "xhs";
  // weibo: m.weibo.cn / weibo.com / weibo.cn，或 ($render_data / __INITIAL_STATE__) 且 (pic_ids / screen_name)
  if (
    t.includes("m.weibo.cn") ||
    t.includes("weibo.com") ||
    t.includes("weibo.cn")
  ) {
    return "weibo";
  }
  if (
    (t.includes("$render_data") || t.includes("__initial_state__")) &&
    (t.includes("pic_ids") || t.includes("screen_name"))
  ) {
    return "weibo";
  }
  // ctrip: you.ctrip.com / m.ctrip.com / ctrip.com，或 window.pageInfo 且 (PublishTitle / TravelId)
  if (
    t.includes("you.ctrip.com") ||
    t.includes("m.ctrip.com") ||
    t.includes("ctrip.com")
  ) {
    return "ctrip";
  }
  if (
    t.includes("window.pageinfo") &&
    (t.includes("publishtitle") || t.includes("travelid"))
  ) {
    return "ctrip";
  }
  return null;
}

/**
 * 统一 HTML 解析入口：按 platform 分派到对应平台 parser。
 * @param html Raw HTML string（完整另存 HTML 或局部都行）
 * @param platform 目标平台（可用 sniffPlatform 先嗅探）
 * @param hintNoteId 调用方可提供 noteId；HTML 里找不到时兜底
 */
export function parseHtml(
  html: string,
  platform: Platform,
  hintNoteId?: string
): ParsedHtmlNote {
  switch (platform) {
    case "xhs":
      return parseXhsHtml(html, hintNoteId);
    case "weibo":
      return parseWeiboHtml(html, hintNoteId);
    case "ctrip":
      return parseCtripHtml(html, hintNoteId);
  }
}
