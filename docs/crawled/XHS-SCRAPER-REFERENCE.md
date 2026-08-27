# 小红书素材库 · 主项目对接手册 (XHS-SCRAPER-REFERENCE)

> ℹ️ **来源说明**:本页内容由 [`crawl-github-journal.ts`](../../scripts/crawl-github-journal.ts) 从姊妹仓库 [Minkelxy/ningxia-tourism](https://github.com/Minkelxy/ningxia-tourism) 真实抓取并镜像,版权归原作者所有。原文可在 GitHub 直接访问。

| 字段 | 值 |
|------|-----|
| 源仓库 | [Minkelxy/ningxia-tourism](https://github.com/Minkelxy/ningxia-tourism) |
| 源路径 | [`XHS-SCRAPER-REFERENCE.md`](https://github.com/Minkelxy/ningxia-tourism/blob/main/XHS-SCRAPER-REFERENCE.md) |
| 抓取日期(UTC) | 2026-08-27T10:56:18 |
| 文件大小 | 10716 bytes |
| 源 commit sha | `df92b93f2394` |

---

## 原文内容

> Sister 仓库：[Minkelxy/ningxia-scraper](https://github.com/Minkelxy/ningxia-scraper)
> 主项目：[Minkelxy/ningxia-tourism](https://github.com/Minkelxy/ningxia-tourism)
> 对应素材库版本：**v0.1.0**
> 本手册复核日期：**2026-08-25**；素材库是独立外部仓库，不属于主项目发布构建。
> 未来扩展：微博 / 携程等平台爬虫将逐步整合到同一 sister 仓库

---

## 1. 概述

外部 sister 素材库 `ningxia-scraper` 是一条合规可追溯的 UGC 素材候选池：它**不生产发布级内容**，
只提供可追溯的小红书公开笔记的线索（标题/正文摘要/图片元数据/来源 URL/作者）。
主项目通过 `xhs-to-content-kit` 脚本把线索转换为编辑任务卡片和 journal 草稿。

**合规红线（不得违反）**：
1. **不得**直接 copy-paste 素材库正文到主项目 journal。转换脚本保证生成的草稿
   与原文相似度 <30%，连续汉字段 <20 字。
2. 素材库中任何 note 的 `verificationLevelHint = "reported"`：
   导入主项目的 journal frontmatter `status` **必须**为 `review`，不得标 `verified`。
3. 每条由素材库转换而来的 journal 必须在 frontmatter 附加 `source_xhs_noteId`、
   `source_xhs_url` 字段，便于溯源。
4. 图片如需使用：必须附原作者署名 + 来源 URL 水印 + 链接。
   原作者在素材库提交下架 Issue 后 24–48 小时内：素材库物理删图 + 主项目同步下线。

---

## 2. 目录互链

Sister 仓库与主项目是两个独立 Git 仓库；推荐本地 clone 为同级目录：

```
workspace/
├── ningxia-tourism/              ← 主项目
│   ├── XHS-SCRAPER-REFERENCE.md  ← 本文件
│   ├── src/content/journal/      ← journal 最终产物 (status=review/verified)
│   └── content-kit/              ← 编辑任务卡片 & 草稿工作目录 (.gitignore)
└── ningxia-scraper/             ← sister 素材库 (独立 clone、LFS 跟踪)
    ├── data/notes.ndjson
    ├── images/full/<noteId>/img-*.webp
    ├── provenance/manifest.csv
    └── scripts/xhs-to-content-kit.ts
```

主项目 `.gitignore` 已追加（见 `.gitignore` 末尾）：
```gitignore
# XHS scraper — content-kit intermediate work dir (main project side)
content-kit/

# Ningxia scraper (sister repo, cloned separately)
ningxia-scraper/
```

---

## 3. 常用对接命令

所有命令在 **sister 仓库根目录 (`../ningxia-scraper/`)** 执行；
`--out-dir` 指向主项目 `content-kit/` 目录。

### 3.1 浏览素材库热度榜
```bash
cd ../ningxia-scraper
python3 scripts/list-top.py -n 20
python3 scripts/list-top.py --topic 沙坡头 --sort collectCount
```

### 3.2 生成「本期编辑任务卡片」（不泄漏原文）
```bash
cd ../ningxia-scraper
npm run content:kit -- \
  --task-list \
  --limit 20 \
  --min-score 200 \
  --out-dir ../ningxia-tourism/content-kit
```

产物：
- `../ningxia-tourism/content-kit/EDIT-TASKS.md`：每行一个任务卡片，格式：
  `[ ] #<index> · <标题截断> · <话题> · <点赞> · <城市> · <素材 noteId>`

贡献者按卡片顺序逐个认领，进入下一步。

### 3.3 对某条 note 生成 journal 草稿
```bash
cd ../ningxia-scraper
npm run content:kit -- \
  --note <noteId> \
  --kind journal \
  --out-dir ../ningxia-tourism/content-kit/journal
```

产物：`../ningxia-tourism/content-kit/journal/<slug>-review.md`

**草稿内容检查清单（必须全部满足才能 PR 到主项目）**：
- [ ] Frontmatter 字段完整，且：
  - `status: review`（绝不能是 verified）
  - `source_xhs_noteId: "<noteId>"` 与素材库一致
  - `source_xhs_url: "https://www.xiaohongshu.com/explore/<noteId>"`
  - `tags` 含 `xhs-reference`
  - `verificationDueDate` 填入 `fetchDate + 180 天`（按主项目 P0-4 规则）
- [ ] 正文**不包含**原文任何连续 20 汉字片段（转换脚本已保证，但人工需再 spot check）
- [ ] 图片如使用，附 `图源：小红书 @<authorNickname>` + 素材库 provenance 链接
- [ ] 城市/景点名经人工校对，不因关键词误命中而错标 city

### 3.4 把草稿搬到主项目正式目录
```bash
# 从 content-kit 人工确认后复制到 src/content/journal
cp ../ningxia-tourism/content-kit/journal/<slug>-review.md \
   ../ningxia-tourism/src/content/journal/<slug>.md
```

### 3.5 主题覆盖率 & 选稿辅助
```bash
cd ../ningxia-scraper
# 生成 coverage.txt 和 TOPICS_RANKING.md
npm run export:topics -- --out-dir ../ningxia-tourism/content-kit
cat ../ningxia-tourism/content-kit/coverage.txt
```

选稿规则：优先挑「未覆盖类目」或「已覆盖但 < 3 条」的类目。
若覆盖率低于 96%，优先补齐未覆盖类目稿件后再发 Release。

---

## 4. Frontmatter 字段映射（journal 模板）

| 素材库字段 XhsNote | 主项目 journal frontmatter | 说明 |
|----------------------|----------------------------|------|
| noteId               | source_xhs_noteId          | 必须 1:1 对应，便于下架追踪 |
| sourceUrl            | source_xhs_url             | 溯源 URL |
| authorNickname       | source_authors: ["xhs@<name>"] | 必须署名 |
| title                | title（重写，不得原样抄）  | 转换脚本已打散语义 |
| topics (string[])    | tags: ["xhs-reference", ...] | 仅作 topic 线索参考 |
| geoHint.cityName     | city                       | 取对应 canonical city slug |
| publishedAt          | source_published_at        | 原样保留 YYYY-MM-DD |
| fetchedAt            | source_fetched_at          | 作为 verificationDueDate + 180 起点 |
| images[].localPath   | cover / gallery             | **需单独二次授权确认**，未授权置空 |
| bodySimhash          | (无对应)                   | 仅素材库侧去重用 |

素材库侧 `removeRequested = { reason, requestedAt, requester }` 的 note：
转换脚本自动过滤，不会生成 journal 草稿。

---

## 5. 下架联动流程

原作者发起下架有两条路径，两侧必须同步动作：

```
素材库 (ningxia-xhs-scraper)                     主项目 (ningxia-tourism)
  ┌───────────────────────────┐                    ┌──────────────────────────┐
  │ submit takedown Issue →   │  维护者确认 48h 内  │  git grep source_xhs_    │
  │ mark-removed <noteId>     │ ─────────────────→ │  noteId → 下线对应 .md  │
  │ (删图 / manifest REMOVED /│                    │  或把 status 置 draft    │
  │  NDJSON 标记 removeReq)   │                    │  并删除已用素材图        │
  └───────────────────────────┘                    └──────────────────────────┘
```

**主项目侧快速排查命令**（维护者在每次 sister 仓库 merge 后执行一次）：
```bash
cd ../ningxia-scraper
# 列所有 removeRequested 的 noteId
jq -c 'select(.removeRequested != false)' data/notes.ndjson > /tmp/removed.ndjson
wc -l /tmp/removed.ndjson

cd ../ningxia-tourism # 切回主项目
while read -r id; do
  echo "== 查找 $id =="
  grep -r "$id" src/content/journal/ --include="*.md" || echo "(未引用)"
done < <(jq -r '.noteId' /tmp/removed.ndjson)
```

---

## 6. 门禁：主项目 PR 侧需触发的合规检查

在主项目 `.github/workflows/deploy.yml`（或新增 xhs-bridge.yml）
建议新增一个 Step（放在 Step 5 提醒之后）：

```yaml
- name: Step 5.2 · 素材库来源 journal 合规巡检
  if: github.event_name == 'pull_request'
  run: |
    # 找到本次 PR 变动的新增/修改 journal
    git diff --name-only origin/main...HEAD -- 'src/content/journal/*.md' > /tmp/pr_journals.txt
    echo "本次 PR 影响 $(wc -l < /tmp/pr_journals.txt) 篇 journal"
    grep -l 'source_xhs_noteId' $(cat /tmp/pr_journals.txt) 2>/dev/null | while read f; do
      status=$(grep -E '^status:' "$f" | head -1 | awk '{print $2}')
      if [ "$status" = "verified" ]; then
        echo "❌ $f: 来源素材库的 journal 不得 status=verified，必须=review" >&2
        exit 1
      fi
    done || true
    echo "✅ 素材库来源 journal status=review 校验通过"
```

---

## 7. 脚本/命令速查表

| 任务 | 执行位置 | 命令 |
|------|----------|------|
| 跑单元测试 | sister | `cd ../ningxia-scraper && npm test` (vitest) |
| 校验全数据集合规 | sister | `cd ../ningxia-scraper && npm run validate:data` |
| 去重报告 | sister | `cd ../ningxia-scraper && npm run dedupe` → `reports/dedupe-YYYYMMDD.md` |
| 批量导入 HTML 快照 | sister | `cd ../ningxia-scraper && npm run ingest:batch -- data-raw/pool/search-snapshots/*.html` |
| 单条导入 HTML | sister | `cd ../ningxia-scraper && npm run ingest:one -- --html <saved.html> --note-url <xhs url>` |
| 下架一条 note | sister | `cd ../ningxia-scraper && npm run mark:removed -- --noteId <id> --reason <...> --requester <email>` |
| 本期编辑任务 | sister → 主项目 | `cd ../ningxia-scraper && npm run content:kit -- --task-list --out-dir ../ningxia-tourism/content-kit` |
| 生成 journal 草稿 | sister → 主项目 | `cd ../ningxia-scraper && npm run content:kit -- --note <id> --kind journal --out-dir ../ningxia-tourism/content-kit/journal` |
| 话题覆盖率报告 | sister → 主项目 | `cd ../ningxia-scraper && npm run export:topics -- --out-dir ../ningxia-tourism/content-kit` |
| 本地跑 sister CI | sister | `cd ../ningxia-scraper && npm run ci:local` (完整门禁) |
| 主项目 PR 合规巡检 | 主项目 | 见 §6 Step 5.2 脚本 |

---

## 8. 版本兼容性

| 素材库版本 | 最低主项目版本要求 | Frontmatter 字段差异 |
|------------|----------------------|----------------------|
| v0.1.x     | v0.3.1+              | `source_xhs_noteId` / `source_xhs_url` / `source_authors[]` / `status=review` 规则已确立；v0.1.x 完全兼容 |
| v0.2.x (计划) | v0.4.0+ | 将新增 `ingestion.engine: playwright` 模式；字段新增会在 CHANGELOG 单独标注 breaking |

---

## 9. 参考链接

- Sister 仓库：<https://github.com/Minkelxy/ningxia-scraper>
- 素材库合规说明：`ningxia-scraper/docs/COMPLIANCE.md`
- 素材库字段字典：`ningxia-scraper/docs/DATA_DICTIONARY.md`
- 素材库 CHANGELOG：`ningxia-scraper/CHANGELOG.md`
- 主项目验证周期（180 天）说明：主项目 `docs/product/DATA_DICTIONARY.md` §170-180 天验证窗口

---

← [返回全量目录](./INDEX.md) · [返回总览](../BROWSE.md) · [在源仓库查看原文](https://github.com/Minkelxy/ningxia-tourism/blob/main/XHS-SCRAPER-REFERENCE.md)
