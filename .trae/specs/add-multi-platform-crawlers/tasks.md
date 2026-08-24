# Tasks

- [x] Task 1: 泛化 Zod Schema 支持多平台
  - [x] SubTask 1.1: 在 `src/schema/note.ts` 把 `SOURCE_PLATFORM` 常量替换为 `SUPPORTED_PLATFORMS` 数组与 `Platform` 类型，新增 `LICENSE`/`VERIFICATION_HINT` 不变
  - [x] SubTask 1.2: `sourcePlatform` 字段改为 `z.enum(["xhs","weibo","ctrip"])`；`sourceUrl` refine 改为按 `sourcePlatform` 分派校验域名（xhs→xiaohongshu.com、weibo→weibo.com/m.weibo.cn、ctrip→you.ctrip.com/m.ctrip.com）
  - [x] SubTask 1.3: `makeSourceId(noteId, platform)` 改签名按平台拼前缀；保留单参调用形式默认 `xhs` 以最小化存量调用点改动
  - [x] SubTask 1.4: 跑 `npm run check` 确认类型通过；跑 `npm run validate:data` 确认存量 xhs 数据全部仍合法（向后兼容验证）

- [x] Task 2: 新增微博解析器
  - [x] SubTask 2.1: 新增 `src/lib/weibo-parser.ts`，导出 `parseWeiboHtml(html, hintId?)` 返回 `ParsedHtmlNote`（从 `./html-parser.js` 导入类型）
  - [x] SubTask 2.2: 抽取 noteId（mid / url 末段 / hintId 兜底）、title、authorNickname、publishedAt、bodyHtml/bodyPlainText、topics(#话题#)、imageUrls(https only)、interaction、geoHint（命中宁夏 5 市/8 个 5A）、sourceUrl
  - [x] SubTask 2.3: 长微博正文拼接（render/text 字段 + DOM fallback），抽不到置 null 不抛错
  - [x] SubTask 2.4: 新增 `tests/fixtures/weibo-sample.html` fixture（脱敏样例，不含真实 PII）

- [x] Task 3: 新增携程解析器
  - [x] SubTask 3.1: 新增 `src/lib/ctrip-parser.ts`，导出 `parseCtripHtml(html, hintId?)` 返回 `ParsedHtmlNote`
  - [x] SubTask 3.2: 抽取游记 id（url 路径段 / hintId 兜底）、title、authorNickname、publishedAt、bodyPlainText、topics、imageUrls、interaction（尽量抽取，抽不到 null）、geoHint
  - [x] SubTask 3.3: sourceUrl 兜底为 `https://you.ctrip.com/TravelBlogs/<id>.html`
  - [x] SubTask 3.4: 新增 `tests/fixtures/ctrip-sample.html` fixture

- [x] Task 4: 统一 HTML 解析调度入口
  - [x] SubTask 4.1: 在 `src/lib/html-parser.ts` 新增 `parseHtml(html, platform, hintId?)` 调度函数，按 platform 分派到 `parseXhsHtml` / `parseWeiboHtml` / `parseCtripHtml`
  - [x] SubTask 4.2: 新增 `sniffPlatform(html)` 嗅探函数：命中 xiaohongshu 标志→xhs；命中 weibo/$render$/m.weibo.cn→weibo；命中 you.ctrip.com→ctrip；嗅不到返回 null
  - [x] SubTask 4.3: 导出 `ParsedHtmlNote` 类型供新解析器复用（原 `parseXhsHtml` 不动）

- [x] Task 5: ingest-one 支持多平台
  - [x] SubTask 5.1: `scripts/ingest-one.ts` 增加 `--platform <xhs|weibo|ctrip>` 选项；未传时调 `sniffPlatform` 自动嗅探，嗅不到报错退出码 2
  - [x] SubTask 5.2: 按平台取 `sourcePlatform`、`sourceUrl` 兜底域名、`makeSourceId(noteId, platform)`；调用 `parseHtml` 而非直接 `parseXhsHtml`
  - [x] SubTask 5.3: 模式 B（--url）占位错误信息改为按目标平台提示

- [x] Task 6: ingest-batch 支持平台前缀清单
  - [x] SubTask 6.1: `scripts/ingest-batch.ts` 输入清单行支持 `weibo:./path.html` / `ctrip:https://...` 前缀语法，无前缀回退 `--platform` 默认值
  - [x] SubTask 6.2: `runBatch` 把平台透传给 `ingestFromHtml`（需扩展 ingest-one 暴露 platform 入参）
  - [x] SubTask 6.3: 批量报告里 successes/failures 记录 platform 字段

- [x] Task 7: content-kit 泛化为多平台
  - [x] SubTask 7.1: 新增 `scripts/content-kit.ts`（复制 `xhs-to-content-kit.ts` 逻辑），对全平台笔记生成草稿与任务卡；`sourceId` 用 `note.source_id`（已是 `<platform>:<noteId>`）
  - [x] SubTask 7.2: 脱敏约束（相似度 <30% / 连续汉字 <20）对全平台正文生效，违反退出码 1
  - [x] SubTask 7.3: `package.json` 新增 `content:kit` 指向 `content-kit.ts`，保留 `xhs-to-content-kit.ts` 文件作为别名入口（或保留脚本名兼容）

- [x] Task 8: validate-dataset 与 storage 适配
  - [x] SubTask 8.1: `scripts/validate-dataset.ts` source_id 校验改为按 `res.data.sourcePlatform` 计算期望前缀，错误消息不再硬编码 `xhs:`
  - [x] SubTask 8.2: `src/lib/storage.ts` persistNote 增加跨平台 noteId 冲突检测：同 noteId 但已存在条目 sourcePlatform 不同时报错，提示用 `--hint-note-id` 加平台前缀（xhs 存量不动）

- [x] Task 9: README 与测试补全
  - [x] SubTask 9.1: `README.md` 更新平台说明（小红书 / 微博 / 携程）、目录结构、采集模式示例
  - [x] SubTask 9.2: `tests/ingest-one.test.ts` 增加 weibo + ctrip 入库用例（用 fixture + nock/dry-run，不真实联网）
  - [x] SubTask 9.3: `tests/scripts.test.ts` 增加 content-kit 跨平台脱敏与 validate source_id 用例
  - [x] SubTask 9.4: 跑 `npm test`（vitest）全绿 + `npm run validate:data` 全绿；确认 spec 触及的文件 0 个新增 tsc 错误（预存 baseline 历史技术债不在本期范围）

# Task Dependencies

- Task 2、Task 3 依赖 Task 4（需先定义 `ParsedHtmlNote` 导出与调度入口契约）→ 可在 Task 4 起步后并行
- Task 5 依赖 Task 1 + Task 4
- Task 6 依赖 Task 5
- Task 7 依赖 Task 1（Schema 泛化后 source_id 才带平台前缀）
- Task 8 依赖 Task 1
- Task 9 依赖 Task 1–8 全部完成
