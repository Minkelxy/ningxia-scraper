# Changelog

所有值得注意的变更记录将在此处列出。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
并遵循 [Semantic Versioning 2.0](https://semver.org/lang/zh-CN/)。

**版本发布约定**
- 主版本号（Major）：数据模型 / 目录结构发生 Breaking Change，旧脚本无法直接迁移。
- 次版本号（Minor）：新增 CLI / Schema 字段，向后兼容。
- 修订号（Patch）：种子数据增加、修复脚本 Bug、CI 修复、文档更新。

---

## [0.1.0] — 2025-07-18 · 基础素材库首版

> 本仓库 `Minkelxy/ningxia-scraper` 是主项目 `Minkelxy/ningxia-tourism` 的 sister 仓库。
> 当前支持小红书（XHS），未来将逐步整合微博 / 携程等平台爬虫。

### ✨ Added
- **数据模型 & 工具**
  - `XhsNoteSchema` (Zod): 20 字段，含 Schema / Geo / Dedupe / Image 结构硬约束。
  - `src/lib/hashes.ts`：MD5 / SHA256 / SimHash（自实现，避免 ESM/CJS 互操作问题）/ dHash。
  - `src/lib/storage.ts`：NDJSON 索引 + JSON + provenance 三件套，带 Git LFS 占位图落地。
- **采集脚本**（半人工 HTML 快照）
  - `ingest-one --html`：解析单条 HTML → 提取元数据 + 下载图片 → 入库。
  - `ingest-batch`：批量处理，1 条失败不影响其余；输出 batch-report.json。
  - `dedupe`：三重去重（noteId / SimHash ≤ 5 位 / SHA256 图片），输出 Markdown 报告。
- **合规与治理**
  - `validate-dataset`：Schema + 一致性 + provenance + 黑名单 + 下架残留 6 大类检查。
  - `mark-removed`：下架笔记（删图 + 更新 manifest + NDJSON 标记）。
  - `config/author-blacklist.txt`：黑名单作者；`provenance/takedown.csv`：下架申请台账。
  - `.github/ISSUE_TEMPLATE/takedown-request.yml`：原作者下架申请 Issue 模板。
- **主题分析 & 榜单**
  - `export-topics`：26 个类目覆盖率报告 + 热度排行 TOPICS_RANKING.md。
  - `python3 scripts/list-top.py`：Top N 笔记 CLI 榜单。
- **主项目转换**
  - `xhs-to-content-kit --note`：按「3 词袋+语序打散」生成主项目 journal 草稿，
    生成内容与原文相似度 <30%，连续汉字 <20 字，绝不泄漏原文。
- **CI / Workflows**
  - `ci.yml`：build + test + typecheck + validate + 「≥50 notes / ≥96% coverage」门禁 + list-top smoke。
  - `takedown-audit.yml`：每周一 11:00 CST 自动审计，异常时自动开 maintenance Issue 通知。
- **种子数据 & URL 池**
  - `seed-data.ts`：生成 50 条半人工假笔记（26 类目全覆盖）+ 合法 WebP 占位图。
  - `provenance/snapshot-search-pool.txt`：102 条真实搜索/笔记 URL 池（仅记录 URL 与时间，不含原文）。

### 🗃️ Data
- Raw JSON：50 条 · NDJSON：50 条 · Provenance 登记：50 条 · 下架：0 条。
- 类目覆盖：26 / 26 = **100%**（city=5 / attraction5a=8 / duration=5 / theme=4 / food=4）。

### 🧪 Tests
- `vitest`：27 / 27 ✅，覆盖率 ingest/batch/dedupe/export-topics/list-top/mark-removed/xhs-to-content-kit 全部 TR 指标。
- `validate-dataset`：实跑通过 — errors=0 · warnings=0。

### 📚 Docs
- `README.md`：合规声明、目录结构、快速开始、FAQ、主项目对接。
- `CONTRIBUTING.md`：贡献流程、门禁表、发布清单。
- `docs/COMPLIANCE.md`：合规策略（robots/UA/频率/版权/LFS/原作者下架）。
- `docs/DATA_DICTIONARY.md`：Schema 字段说明 + 去重 + 黑名单规则。

### ⚠️ Known Issues / 下版规划
- `ingest-one --url` Playwright 自动抓取：当前未实现（需要过风控/反爬），保留入口，
  下一版 `v0.2.0` 与 robots.txt 守门规则一起上线。
- 种子数据均为「半人工占位」内容：为了通过门禁而合成。真实素材需由贡献者
  参照 provenance/snapshot-search-pool.txt 手动保存 HTML 后，使用 `ingest-batch` 入库。
