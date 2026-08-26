#!/usr/bin/env tsx
/**
 * scripts/search-xhs-noteids.ts
 *
 * 复用 login:xhs 的持久化 user-data-dir(登录态),自动在小红书搜索宁夏旅游
 * 关键词,滚动加载,收集笔记 noteId,去重追加写入 data-raw/xhs/note-ids.txt。
 * 之后 crawl:xhs 直接读这个文件抓取,形成「搜 → 抓」闭环。
 *
 * 前置:先跑过一次 npm run login:xhs 登录(user-data-dir 存登录态)。
 * 已登录后可用 --headless 后台自动跑(无需交互)。
 *
 * 小红书搜索 API 需 x-s 签名,脚本难直接调;但搜索结果页本身是真实浏览器
 * 渲染,用持久化 context 打开 search_result?keyword= 滚动,从 DOM 里
 * a[href*="/explore/"] 提取 noteId 即可,绕过签名问题。
 *
 * 用法:
 *   npm run search:xhs                 # headed,能看到滚动过程
 *   npm run search:xhs -- --headless   # 已登录态,后台自动跑
 *   npm run search:xhs -- --keywords 沙坡头 贺兰山 --scrolls 5
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_KEYWORDS = [
  "宁夏旅游",
  "宁夏攻略",
  "宁夏自驾",
  "沙坡头",
  "西夏王陵",
  "贺兰山",
  "银川旅游",
  "中卫旅游",
  "沙湖",
  "六盘山",
  "镇北堡",
  "水洞沟",
];

const DATA_DIR = path.resolve(ROOT, "playwright/user-data-dir/xhs");
const IDS_FILE = path.resolve(ROOT, "data-raw/xhs/note-ids.txt");

// 从现有 note-ids.txt 读已收集的 noteId(# 注释行忽略),返回 {ids, lines}
function readExisting(): { ids: Set<string>; lines: string[] } {
  const ids = new Set<string>();
  const lines: string[] = [];
  if (fs.existsSync(IDS_FILE)) {
    for (const raw of fs.readFileSync(IDS_FILE, "utf-8").split(/\r?\n/)) {
      lines.push(raw);
      const t = raw.trim();
      if (t && !t.startsWith("#")) ids.add(t);
    }
  }
  return { ids, lines };
}

async function collectFromSearch(
  page: Page,
  keyword: string,
  scrolls: number
): Promise<Set<string>> {
  const found = new Set<string>();
  const url = `https://www.xiaohongshu.com/search_result?source=web_explore_feed&keyword=${encodeURIComponent(
    keyword
  )}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // 等笔记卡片渲染;小红书首屏渲染较慢
  await page.waitForTimeout(2500);
  for (let s = 0; s < scrolls; s++) {
    // 收集当前 DOM 里所有 explore/discovery 链接的 noteId
    const hrefs = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          'a[href*="/explore/"], a[href*="/discovery/item/"]'
        )
      )
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")
    );
    for (const h of hrefs) {
      // noteId 形如 24 位十六进制;放宽到 18+ 位字母数字,兼容历史格式
      const m = h.match(/(?:explore|discovery\/item)\/([A-Za-z0-9_-]{18,})/);
      if (m && m[1]) found.add(m[1]);
    }
    // 滚动到底加载更多(小红书是瀑布流)
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(1500);
  }
  return found;
}

async function main() {
  // 过滤 npm/tsx 透传的 "--" 分隔符
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const headless = argv.includes("--headless");

  let keywords = DEFAULT_KEYWORDS;
  const kwIdx = argv.indexOf("--keywords");
  if (kwIdx !== -1) {
    // 收集到下一个 --flag 为止,避免吞掉后续 flag 的值
    const collected: string[] = [];
    for (const a of argv.slice(kwIdx + 1)) {
      if (a.startsWith("--")) break;
      collected.push(a);
    }
    if (collected.length > 0) keywords = collected;
  }

  let scrolls = 4;
  const sIdx = argv.indexOf("--scrolls");
  if (sIdx !== -1) {
    const v = argv[sIdx + 1];
    if (v) scrolls = parseInt(v, 10);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(IDS_FILE), { recursive: true });

  console.log(
    `[search-xhs] 模式:${headless ? "headless" : "headed"}  关键词:${keywords.length} 个  每词滚动:${scrolls} 次`
  );
  console.log(`[search-xhs] user-data-dir:${path.relative(ROOT, DATA_DIR)}`);

  const ctx = await chromium.launchPersistentContext(DATA_DIR, {
    headless,
    viewport: { width: 1280, height: 900 },
    userAgent: UA,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  let totalNotFound = 0; // 完全搜不到 noteId 的关键词数(可能未登录/被风控)
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const all = new Set<string>();
    for (const kw of keywords) {
      try {
        const found = await collectFromSearch(page, kw, scrolls);
        let added = 0;
        for (const id of found) {
          if (!all.has(id)) {
            all.add(id);
            added++;
          }
        }
        console.log(
          `[search-xhs] "${kw}": 收集 ${found.size} 个 noteId,累计新增 ${added}`
        );
        if (found.size === 0) totalNotFound++;
      } catch (e) {
        console.warn(
          `[search-xhs] "${kw}" 失败:${e instanceof Error ? e.message : e}`
        );
        totalNotFound++;
      }
      await page.waitForTimeout(800); // 礼貌限速
    }

    // 合并已有,追加新 ID
    const existing = readExisting();
    const newIds = [...all].filter((id) => !existing.ids.has(id));
    for (const id of newIds) {
      existing.ids.add(id);
      existing.lines.push(id);
    }
    if (newIds.length > 0) {
      // 保留原文件结构(注释 + 已有 ID),追加新 ID
      fs.writeFileSync(IDS_FILE, existing.lines.join("\n") + "\n", "utf-8");
    }

    console.log("");
    console.log(
      `[search-xhs] ✅ 本次共 ${all.size} 个 noteId,新增 ${newIds.length} 个`
    );
    console.log(`[search-xhs] 文件现有 ${existing.ids.size} 个 noteId → ${path.relative(ROOT, IDS_FILE)}`);
    if (totalNotFound === keywords.length && all.size === 0) {
      console.warn(
        "[search-xhs] ⚠️ 所有关键词都未搜到 noteId,可能未登录或被风控。先跑 npm run login:xhs 登录,或用 --headed 看页面实际情况。"
      );
    } else if (totalNotFound > 0) {
      console.warn(
        `[search-xhs] ⚠️ 有 ${totalNotFound}/${keywords.length} 个关键词未搜到 noteId(可能被风控限流,下次重试即可)`
      );
    }
    console.log(`[search-xhs] 下一步:npm run crawl:xhs`);
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error("[search-xhs] 致命错误:", e);
  process.exit(1);
});
