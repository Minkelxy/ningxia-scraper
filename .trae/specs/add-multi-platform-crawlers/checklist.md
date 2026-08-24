# Checklist

## Schema 与向后兼容
- [x] `src/schema/note.ts` 中 `sourcePlatform` 已改为 `z.enum(["xhs","weibo","ctrip"])`
- [x] `sourceUrl` refine 按 `sourcePlatform` 分派校验对应域名（xhs→xiaohongshu.com、weibo→weibo.com/m.weibo.cn、ctrip→you.ctrip.com/m.ctrip.com）
- [x] `makeSourceId(noteId, platform)` 按平台拼前缀（`xhs:` / `weibo:` / `ctrip:`）
- [x] 存量 xhs 数据不做迁移仍全部通过 `npm run validate:data`
- [x] `npm run check` 类型通过

## 微博解析器
- [x] `src/lib/weibo-parser.ts` 导出 `parseWeiboHtml(html, hintId?)` 返回 `ParsedHtmlNote`
- [x] noteId 取微博 mid / url 末段 / hintId 兜底
- [x] 长微博正文从 render/text 字段 + DOM fallback 抽取并拼接
- [x] 图片 originalUrl 均为 https；抽不到的互动字段置 null 不抛错
- [x] geoHint 命中宁夏 5 市 / 8 个 5A
- [x] `tests/fixtures/weibo-sample.html` fixture 已就位（脱敏无 PII）

## 携程解析器
- [x] `src/lib/ctrip-parser.ts` 导出 `parseCtripHtml(html, hintId?)` 返回 `ParsedHtmlNote`
- [x] noteId 取游记 id / hintId 兜底；sourceUrl 兜底 `https://you.ctrip.com/TravelBlogs/<id>.html`
- [x] title/bodyPlainText/imageUrls 抽取正确；互动抽不到置 null
- [x] `tests/fixtures/ctrip-sample.html` fixture 已就位

## 统一调度与嗅探
- [x] `src/lib/html-parser.ts` 新增 `parseHtml(html, platform, hintId?)` 调度函数，按平台分派
- [x] 新增 `sniffPlatform(html)`：xiaohongshu→xhs、weibo/m.weibo.cn/$render$→weibo、you.ctrip.com→ctrip、嗅不到返回 null
- [x] 原 `parseXhsHtml` 未被改动（向后兼容）

## ingest-one / ingest-batch
- [x] `ingest-one` 支持 `--platform <xhs|weibo|ctrip>`，未传时自动嗅探，嗅不到退出码 2
- [x] 按平台取 sourcePlatform / sourceUrl 兜底 / makeSourceId，调用 `parseHtml`
- [x] 模式 B（--url）占位错误按目标平台给出提示
- [x] `ingest-batch` 清单行支持 `weibo:./path` / `ctrip:url` 前缀，无前缀回退 `--platform`
- [x] 批量报告 successes/failures 记录 platform 字段

## content-kit 多平台
- [x] `scripts/content-kit.ts` 对全平台笔记生成草稿与任务卡
- [x] 草稿 `sourceId` 用 `note.source_id`（`<platform>:<noteId>`）
- [x] 脱敏约束（相似度 <30% / 连续汉字 <20）对微博、携程正文生效，违反退出码 1
- [x] `package.json` 新增 `content:kit` 脚本；`xhs-to-content-kit.ts` 保留为兼容入口

## validate-dataset 与 storage
- [x] `validate-dataset.ts` source_id 校验按 `res.data.sourcePlatform` 计算期望前缀，错误消息不再硬编码 `xhs:`
- [x] `storage.ts` persistNote 检测跨平台 noteId 冲突（同 noteId 不同 sourcePlatform）并报错提示加前缀
- [x] xhs 存量数据 persistNote 行为不变

## 文档与测试门禁
- [x] `README.md` 已更新平台说明、目录结构、采集模式示例
- [x] `tests/ingest-one.test.ts` 含 weibo + ctrip 入库用例（fixture + dry-run，不联网）
- [x] `tests/scripts.test.ts` 含 content-kit 跨平台脱敏 + validate source_id 用例
- [x] `npm test`（vitest）全绿（含新增用例）
- [x] `npm run validate:data` 全绿（存量 + 新增平台数据）
- [x] spec 新增/修改文件（note.ts / weibo-parser / ctrip-parser / html-parser / content-kit / ingest-one / ingest-batch / validate-dataset / storage）0 个**新增** tsc 错误（预存 baseline 在 hashes.ts / image-downloader.ts / seed-data.ts / mark-removed.ts / xhs-to-content-kit.ts / 既有测试文件中的 ~35 个 tsc 错误属历史技术债，不在本期「增加爬虫」范围内）
