#!/usr/bin/env tsx
/**
 * scripts/login-playwright.ts
 *
 * 用 Playwright 启动一个**有界面的独立 Chromium**(非无头),你在它里面登录,
 * 脚本自动捕获 cookie 落盘 → 现有 crawl-*.ts 优先读本地 cookie 文件抓取。
 * 持久化 user-data-dir,下次免重新登录(登录态存盘)。
 *
 * 优势:
 *   - 不用你碰个人浏览器/不用手抄 DevTools Cookie
 *   - 一个 Playwright 控制的干净浏览器,登录态隔离
 *   - user-data-dir 持久化,下次扫码/登录可免
 *   - cookie 自动落 config/secrets/<platform>-cookie.txt(gitignored)
 *   - 同时打印 cookie 字符串,方便贴到 GitHub Secret 给 CI 用
 *
 * 用法(本地有显示器的机器跑;沙盒/CI 无显示不适用):
 *   npm run login:weibo              # 弹出 Chromium,登录 m.weibo.cn
 *   npm run login:xhs                # 弹出 Chromium,登录 www.xiaohongshu.com
 *   npm run login:weibo -- --headless # 仅用于无界面环境自检(无法真登录)
 *
 * 流程:
 *   1. 启动持久化 Chromium(headed),user-data-dir = playwright/user-data-dir/<platform>
 *   2. 打开平台登录页
 *   3. 终端提示「请在浏览器登录,完成后回到终端按回车」
 *   4. 你登录(扫码/账密),回到终端按回车
 *   5. 脚本导出 context.cookies() → 拼 "name=value; ..." → 落盘 + 打印
 *   6. user-data-dir 保留,下次直接复用
 */
import { chromium, type BrowserContext } from "playwright";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

type Platform = "weibo" | "xhs";

const PLATFORMS: Record<
  Platform,
  {
    name: string;
    loginUrl: string;
    homeUrl: string; // 登录成功后跳转/可访问的页面
    dataDir: string; // user-data-dir 子目录
    cookieFile: string; // cookie 落盘文件
    envVar: string; // 对应环境变量名(给提示用)
    keyCookies: string[]; // 登录态关键 cookie 名(用于自检)
  }
> = {
  weibo: {
    name: "微博",
    loginUrl: "https://m.weibo.cn/login",
    homeUrl: "https://m.weibo.cn/",
    dataDir: "playwright/user-data-dir/weibo",
    cookieFile: "config/secrets/weibo-cookie.txt",
    envVar: "WEIBO_COOKIE",
    keyCookies: ["SUB", "SUBP"],
  },
  xhs: {
    name: "小红书",
    loginUrl: "https://www.xiaohongshu.com/login",
    homeUrl: "https://www.xiaohongshu.com/",
    dataDir: "playwright/user-data-dir/xhs",
    cookieFile: "config/secrets/xhs-cookie.txt",
    envVar: "XHS_COOKIE",
    keyCookies: ["web_session", "a1"],
  },
};

async function pressEnterToContinue(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    await rl.question(prompt);
  } finally {
    rl.close();
  }
}

// 把 Playwright Cookie[] 拼成浏览器 Cookie 请求头格式
function cookiesToHeader(cookies: { name: string; value: string }[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function exportCookies(
  ctx: BrowserContext,
  platform: Platform
): Promise<{ header: string; matched: string[] }> {
  const cfg = PLATFORMS[platform];
  // 只导出目标域的 cookie,避免混入无关项
  const all = await ctx.cookies();
  const filtered = all.filter((c) => {
    const d = c.domain.replace(/^\./, "");
    if (platform === "weibo") return d.endsWith("weibo.cn") || d.endsWith("weibo.com") || d.endsWith("sina.com.cn");
    return d.endsWith("xiaohongshu.com");
  });
  const header = cookiesToHeader(filtered);
  const present = new Set(filtered.map((c) => c.name));
  const matched = cfg.keyCookies.filter((k) => present.has(k));
  return { header, matched };
}

async function saveCookieFile(relPath: string, header: string): Promise<string> {
  const abs = path.resolve(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, header, "utf-8");
  // 设 0600 权限(仅属主可读写),cookie 是敏感数据
  try {
    fs.chmodSync(abs, 0o600);
  } catch {
    // Windows / 某些 FS 忽略
  }
  return abs;
}

async function main() {
  // 过滤掉 npm/tsx 透传的 "--" 分隔符,取第一个位置参数作平台名
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const platformArg = (argv[0] ?? "").replace(/^--/, "") as Platform;
  const headless = argv.includes("--headless");

  if (platformArg !== "weibo" && platformArg !== "xhs") {
    console.error(
      "用法: npm run login:weibo | npm run login:xhs [-- --headless]\n  platform 必须是 weibo 或 xhs"
    );
    process.exit(2);
  }
  const cfg = PLATFORMS[platformArg];
  const dataDir = path.resolve(ROOT, cfg.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });

  console.log(`[login] 平台:${cfg.name}  模式:${headless ? "headless(自检)" : "headed(可登录)"}`);
  console.log(`[login] user-data-dir:${path.relative(ROOT, dataDir)}`);

  // launchPersistentContext:保留登录态/缓存,下次免登录
  // 沙盒里需 --no-sandbox;headed 在无显示器环境会失败(用 --headless 自检)
  const ctx = await chromium.launchPersistentContext(dataDir, {
    headless,
    viewport: { width: 1280, height: 800 },
    userAgent:
      platformArg === "xhs"
        ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        : "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    console.log(`[login] 打开登录页:${cfg.loginUrl}`);
    await page.goto(cfg.loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    if (headless) {
      // 自检模式:不交互,只验证导航+cookie 导出函数,然后退出
      console.log("[login] --headless 自检:等待 3s 后导出当前 cookie(未登录,仅验证链路)");
      await page.waitForTimeout(3000);
      const { header, matched } = await exportCookies(ctx, platformArg);
      console.log(`[login] 自检通过。当前 cookie 长度=${header.length},关键 cookie 命中=${matched.length}`);
      console.log("[login] (自检不落盘;真正登录请去掉 --headless 在有显示器的机器跑)");
      return;
    }

    console.log("");
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log(`│  请在弹出的 Chromium 里登录 ${cfg.name.padEnd(4)}                │`);
    console.log("│  登录成功后,回到此终端按回车继续 → 脚本自动捕获 cookie     │");
    console.log("└─────────────────────────────────────────────────────────────┘");
    console.log("");
    await pressEnterToContinue("登录完成后按回车继续 > ");

    // 再跳首页确认登录态稳定
    try {
      await page.goto(cfg.homeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(1500);
    } catch {
      // 跳首页失败不致命,继续导出已有 cookie
    }

    const { header, matched } = await exportCookies(ctx, platformArg);
    if (!header) {
      console.error("[login] ❌ 没捕获到任何 cookie。确认已登录后重试。");
      process.exit(1);
    }

    const abs = await saveCookieFile(cfg.cookieFile, header);
    console.log("");
    console.log(`[login] ✅ cookie 已落盘:${path.relative(ROOT, abs)} (权限 0600)`);
    console.log(`[login] 关键 cookie 命中:${matched.length ? matched.join(", ") : "(无,登录可能未完成 — 检查后重试)"}`);
    console.log("");
    console.log("── 现有 crawl 脚本会自动读这个文件 ──");
    console.log(`  npm run crawl:${platformArg === "weibo" ? "weibo" : "xhs"}`);
    console.log("");
    console.log("── 给 CI 用:把下面整段贴到 GitHub Secret ──");
    console.log(`  仓库 Settings → Secrets → New repository secret`);
    console.log(`  Name : ${cfg.envVar}`);
    console.log(`  Value: (见 ${path.relative(ROOT, abs)} 文件内容)`);
    console.log("");
    console.log(`cookie 字符串(已存盘,这里不回显以免泄漏到日志;直接看文件):`);
    console.log(`  ${header.length} 字符,关键 cookie: ${matched.length ? matched.join(",") : "无"}`);
    console.log("");
    console.log(`[login] user-data-dir 已保留,下次跑同命令可直接复用登录态(免登录)`);
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error("[login] 致命错误:", e);
  process.exit(1);
});
