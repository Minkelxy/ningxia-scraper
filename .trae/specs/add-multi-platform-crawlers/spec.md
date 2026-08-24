# 多平台爬虫扩展 (add-multi-platform-crawlers) Spec

## Why

当前 ningxia-scraper 仅支持小红书（XHS），Schema 与采集链路都被硬编码在 XHS 上：`sourcePlatform` 字面量为 `"xhs"`、`sourceUrl` refine 强制 `xiaohongshu.com`、解析器 `parseXhsHtml` 与导出脚本 `xhs-to-content-kit.ts` 均与平台强耦合。README 路线图明确指出「未来将逐步整合微博 / 携程等文字图片内容平台的爬虫」。本期目标是把这个「公开内容 → 标准化 JSON → 去重 → 合规 provenance → 主项目对接」的可复用链路从 XHS 单平台扩展到微博与携程，为编辑提供更广的 UGC 素材候选池，同时保持对存量 XHS 数据 100% 向后兼容。

## What Changes

- 把 `src/schema/note.ts` 中 `sourcePlatform` 从字面量 `xhs` 泛化为枚举 `xhs | weibo | ctrip`。
- `sourceUrl` 的 refine 从「只允许 xiaohongshu.com」改为按 `sourcePlatform` 分派校验对应域名（xhs→xiaohongshu.com、weibo→weibo.com / m.weibo.cn、ctrip→you.ctrip.com / m.ctrip.com）。
- `makeSourceId(noteId, platform)` 改为按平台拼前缀（`xhs:` / `weibo:` / `ctrip:`），`SOURCE_PLATFORM` 常量改为平台枚举集合 `SUPPORTED_PLATFORMS`。
- 新增 `src/lib/weibo-parser.ts`：解析微博正文 / 图片笔记（单条 weibo 或长微博），输出复用现有 `ParsedHtmlNote` 契约。
- 新增 `src/lib/ctrip-parser.ts`：解析携程游记（you.ctrip.com travelnotes）与点评，输出复用 `ParsedHtmlNote` 契约。
- `src/lib/html-parser.ts` 的 `parseXhsHtml` 保留不动（向后兼容），导出统一的 `parseHtml(html, platform, hintId?)` 调度函数按平台分派到对应解析器。
- `scripts/ingest-one.ts` 增加 `--platform <xhs|weibo|ctrip>` 选项（不传则从 HTML 内容自动嗅探）；按平台取 `sourcePlatform`、`sourceUrl` 兜底域名、`makeSourceId`。
- `scripts/ingest-batch.ts`：输入清单行支持 `<platform>:<path-or-url>` 前缀语法，`--platform` 作为默认值，自动透传给 `ingest-one`。
- `scripts/xhs-to-content-kit.ts` 泛化为 `scripts/content-kit.ts`（保留 `xhs-to-content-kit` 作为别名脚本入口）：对非 xhs 笔记也生成草稿与任务卡，`sourceId` 用 `<platform>:<noteId>`，正文脱敏约束（相似度 <30% / 连续汉字 <20）对全平台生效。
- `scripts/validate-dataset.ts`：`source_id` 校验消息从硬编码 `xhs:` 改为按笔记的 `sourcePlatform` 计算；其它校验逻辑不变。
- `src/lib/storage.ts`：`noteId` 跨平台全局唯一约束——若新写入的 `(sourcePlatform, noteId)` 与已存在条目的 `noteId` 冲突但平台不同，报错并提示用 `--hint-note-id` 加平台前缀重命名（xhs 存量数据不动）。
- `README.md`：把「当前支持小红书」改为「当前支持小红书 / 微博 / 携程」，更新目录结构与采集模式说明。
- 新增测试 fixture：`tests/fixtures/weibo-sample.html`、`tests/fixtures/ctrip-sample.html`，并补 `ingest-one.test.ts` 与 `scripts.test.ts` 对应用例。

### 平台差异约定
- **微博 (weibo)**：`noteId` 取微博 mid 或 url 末段 id（纯数字）；`sourceUrl` 形如 `https://weibo.com/<uid>/<mid>` 或 `https://m.weibo.cn/detail/<id>`；正文从 `render` 字段或 `text` DOM 抽取，长微博需拼接；图片走 `pic_ids` / `pic_infos`。
- **携程 (ctrip)**：`noteId` 取游记 ID（you.ctrip.com/travelogs/\<id\>.html 路径段）；`sourceUrl` 形如 `https://you.ctrip.com/TravelBlogs/<id>.html`；正文从游记正文 DOM 抽取，图片从 og:image + 正文 `<img>` 抽取；互动数据（点赞/收藏/评论）尽量抽取，抽不到置 null。
- 三个平台统一遵守：图片 originalUrl 必须 `https://`；不抓评论区 PII；license 固定 `for-reference-only`；`verificationLevelHint` 固定 `reported`。

## Impact

- Affected specs: FR-2（标准化 Schema 字段）、FR-3（采集模式 A/B）、NFR-4（https only）、AC-5（绝不泄漏原文）。
- Affected code:
  - `src/schema/note.ts`（Schema 泛化，**向后兼容**：存量 xhs 数据全部仍合法）
  - `src/lib/html-parser.ts`、新增 `src/lib/weibo-parser.ts`、`src/lib/ctrip-parser.ts`
  - `scripts/ingest-one.ts`、`scripts/ingest-batch.ts`
  - `scripts/xhs-to-content-kit.ts` → `scripts/content-kit.ts`
  - `scripts/validate-dataset.ts`
  - `src/lib/storage.ts`（noteId 跨平台唯一性校验）
  - `package.json`（新增 `content:kit` 别名脚本、保留旧名）
  - `README.md`
  - `tests/ingest-one.test.ts`、`tests/scripts.test.ts`、新增 fixture

## ADDED Requirements

### Requirement: 多平台 Schema 支持

系统 SHALL 允许 `sourcePlatform` 取值 `xhs | weibo | ctrip`，并按平台校验 `sourceUrl` 域名；存量 xhs 笔记 SHALL 在不做任何迁移的前提下继续通过 Zod 校验。

#### Scenario: 存量 xhs 数据向后兼容
- **GIVEN** `data-raw/json/` 下既有 xhs 笔记（`sourcePlatform="xhs"`、`sourceUrl` 为 xiaohongshu.com）
- **WHEN** 运行 `npm run validate:data`
- **THEN** 全部 xhs 笔记通过校验，无 schema 错误

#### Scenario: 微博笔记入库
- **WHEN** 用户 `npm run ingest:one -- --platform weibo --html ./data-raw/html/weibo-sample.html`
- **THEN** 生成 `sourcePlatform="weibo"`、`source_id="weibo:<mid>"`、`sourceUrl` 为 weibo.com / m.weibo.cn 的笔记，写入 ndjson + provenance

#### Scenario: 携程游记入库
- **WHEN** 用户 `npm run ingest:one -- --platform ctrip --html ./data-raw/html/ctrip-sample.html`
- **THEN** 生成 `sourcePlatform="ctrip"`、`source_id="ctrip:<travelId>"`、`sourceUrl` 为 you.ctrip.com 的笔记

### Requirement: 微博解析器

系统 SHALL 提供 `parseWeiboHtml(html, hintId?)` 函数，从另存的微博正文页 HTML 中抽取 `ParsedHtmlNote` 全部字段；抽不到的字段置 null，绝不编造。

#### Scenario: 长微博正文与图片抽取
- **GIVEN** 一条包含长微博正文 + 多图的微博另存 HTML
- **WHEN** 调用 `parseWeiboHtml`
- **THEN** 返回 `bodyPlainText` 非空、`imageUrls` 至少 1 张且均为 https、`noteId` 为微博 mid（或 hintId 兜底）

#### Scenario: 字段缺失不抛错
- **GIVEN** 一条仅剩正文、无互动数据的微博 HTML
- **WHEN** 调用 `parseWeiboHtml`
- **THEN** `likeCount` / `collectCount` / `commentCount` 置 null，函数正常返回

### Requirement: 携程解析器

系统 SHALL 提供 `parseCtripHtml(html, hintId?)` 函数，从携程游记另存 HTML 抽取 `ParsedHtmlNote`。

#### Scenario: 游记正文与封面抽取
- **GIVEN** 一条 you.ctrip.com 游记另存 HTML
- **WHEN** 调用 `parseCtripHtml`
- **THEN** 返回 `title` 非空、`bodyPlainText` 非空、`noteId` 为游记 id、`sourceUrl` 为 you.ctrip.com 域名

### Requirement: 平台自动嗅探

`ingest-one` 在未显式传 `--platform` 时 SHALL 从 HTML 内容嗅探平台（命中 xiaohongshu 标志 → xhs；命中 weibo/$render$ → weibo；命中 you.ctrip.com → ctrip）；嗅探失败 SHALL 报错并要求显式传 `--platform`，退出码 2。

#### Scenario: 自动嗅探微博
- **WHEN** 用户 `npm run ingest:one -- --html ./data-raw/html/weibo.html`（未带 --platform）
- **THEN** 脚本识别为 weibo 并按微博链路入库

### Requirement: 多平台 content-kit

`content:kit` SHALL 对所有平台笔记生成草稿与任务卡；`sourceId` 用 `<platform>:<noteId>`；脱敏约束（相似度 <30% / 连续汉字 <20）对全平台生效，违反时退出码 1。

#### Scenario: 微博草稿脱敏
- **WHEN** 对一条微博笔记运行 `content:kit --note <weiboNoteId>`
- **THEN** 生成的草稿正文与原微博正文相似度 <30%，连续汉字段 <20 字

## MODIFIED Requirements

### Requirement: 采集模式 A/B（原仅 XHS）

模式 A（半人工离线 HTML 解析）与模式 B（Playwright URL 抓取）的契约扩展到微博与携程：模式 B 同样遵守 robots.txt Disallow 即拒绝、单线程 + 默认 3 秒间隔、不持久化 Cookie/Token。模式 B 在本期仍是占位（与 XHS MVP 一致），但拒绝信息要带上对应平台提示。

### Requirement: validate-dataset 的 source_id 校验（原硬编码 xhs:）

`source_id` 校验 SHALL 改为按笔记自身 `sourcePlatform` 计算期望值（`<platform>:<noteId>`），错误消息不再硬编码 `xhs:`。

## REMOVED Requirements

无。本变更为纯增量 + 向后兼容泛化，不删除任何既有能力。
