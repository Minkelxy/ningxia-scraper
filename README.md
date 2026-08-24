# ⚠️ 版权合规声明 · Copyright Notice

> **字体加大提示 · BIG NOTICE**
>
> **本仓库仅包含公开 UGC（用户生成内容）的素材候选数据。所有内容版权归原作者所有。**
>
> - 本仓库内容 **仅用于内部编辑参考**，不得以任何形式直接转载、商用、冒充原创。
> - 所有图片、正文、标题均来自小红书公开笔记，已附 provenance（来源 URL / 作者昵称 / 抓取日期）。
> - **若您是原作者且不希望内容被收录**：请提交 [下架 Issue](.github/ISSUE_TEMPLATE/takedown-request.yml) 或邮件联系维护者，我们将在 **24–48 小时内** 物理删除图片并标记条目过滤。
> - 素材部分许可证：`CONTENT ONLY FOR REFERENCE / NO REDISTRIBUTION WITHOUT AUTHOR CONSENT`。代码部分：MIT License。

---

# 宁夏旅游 · 多平台素材库 (ningxia-scraper)

> Sister repository of [Minkelxy/ningxia-tourism](https://github.com/Minkelxy/ningxia-tourism) · [对接手册](../XHS-SCRAPER-REFERENCE.md)

本仓库建立一条「公开内容 → 标准化 JSON → 去重 → 合规 provenance → 与主项目对接」的可复用采集链路。目的是为宁夏旅游主项目的**亲历游记 / 探店 / 专题编辑**提供可追溯的 UGC 素材候选池，不直接生产发布级内容。

当前支持小红书（XHS）/ 微博（weibo）/ 携程（ctrip）三个平台的图文 UGC 采集。

## ⚙️ 快速开始 (5 分钟上手)

```bash
# 1. Clone
git lfs install
git clone https://github.com/Minkelxy/ningxia-scraper.git
cd ningxia-scraper

# 2. Install (Node 22+)
npm ci
npm audit --audit-level=high

# 3. 浏览素材库（不需要 Node，纯 Python 标准库）
python3 scripts/list-top.py --help
python3 scripts/list-top.py --sort likeCount -n 20
python3 scripts/list-top.py --topic 沙坡头 --sort collectCount

# 4. 校验整个数据集的合规性
npm run validate:data

# 5. 导出关键词覆盖率和热门榜
npm run export:topics -- --coverage > coverage.txt
cat coverage.txt
```

## 📁 目录结构

```
ningxia-xhs-scraper/
├── README.md                     ← 本文件
├── CONTRIBUTING.md               ← 贡献规则 (6 条合规红线)
├── LICENSE                       ← 代码 MIT + 素材仅限参考
├── CODE_OF_CONDUCT.md            ← 尊重原作者行为准则
├── CHANGELOG.md                  ← 版本变更记录
├── package.json / tsconfig.json
├── .gitattributes                ← Git LFS 图片托管
├── .gitignore                    ← 登录态/缓存不入库
│
├── data-raw/                     ← 原始抓取数据 (不可编辑)
│   ├── html/                     ← 半人工另存的 XHS 笔记 HTML (可选)
│   ├── json/                     ← 单条笔记原始解析 JSON (1 file = 1 noteId)
│   └── pool/                     ← URL 候选池 + 搜索快照
│
├── data/                         ← 标准化数据 (机器可读)
│   ├── notes.ndjson              ← 全量笔记 NDJSON (1 行 = 1 条，可 jq 流式处理)
│   └── notes-index.json          ← 轻量索引 (noteId → 摘要字段，供 list-top.py 读)
│
├── images/                       ← 图片二进制 (Git LFS)
│   ├── full/                     ← 原图 /<noteId>/img-001.webp ...
│   └── thumbs/                   ← 缩略图 (.gitignore，本地生成不上传)
│
├── provenance/
│   └── manifest.csv              ← 全量 provenance 清单 (可审计、含下架记录)
│
├── scripts/                      ← 所有 CLI 脚本
│   ├── ingest-one.ts             ← 单条采集 (--html 或 --url)
│   ├── ingest-batch.ts           ← 批量采集 (并发 1-2，限速)
│   ├── validate-dataset.ts       ← 数据集合规校验 (Zod Schema + provenance)
│   ├── dedupe.ts                 ← 去重 (noteId / simhash / 图 sha256 / 感知哈希)
│   ├── export-topics.ts          ← 覆盖率报告 + 关键词热度榜
│   ├── content-kit.ts            ← 多平台草稿生成 (xhs/weibo/ctrip，绝不泄漏原文)
│   ├── xhs-to-content-kit.ts     ← XHS 专用草稿生成 (兼容旧入口)
│   ├── mark-removed.ts           ← 标记下架 + 物理删图 + provenance 留痕
│   └── list-top.py               ← 极简 CLI 浏览 (Python 3 标准库无依赖)
│
├── src/
│   ├── lib/
│   │   ├── html-parser.ts        ← 统一 HTML 解析入口 (按平台分派 + 嗅探)
│   │   ├── ctrip-parser.ts       ← 携程游记 HTML 解析
│   │   └── weibo-parser.ts       ← 微博 HTML 解析
│   └── schema/note.ts            ← Zod Schema 定义 (FR-2 完整字段)
│
├── config/
│   ├── topics.yaml               ← 25+ 关键词类目 (5市 / 8个5A / 天数 / 美食 / 主题)
│   └── author-blacklist.txt      ← 不希望收录的作者名单 (支持 # 注释)
│
├── tests/                        ← vitest 单元测试 (脚本 ≥80% 行覆盖)
│   └── fixtures/                 ← 测试 fixture (sample HTML / 假数据 JSON)
│
├── dist/content-kit/             ← xhs-to-content-kit 的输出 (未跟踪, 生成产物)
│   ├── task-cards.md             ← 给主项目 docs/content/maintenance.md 用的编辑任务卡
│   └── drafts/<noteId>.md        ← 给主项目编辑直接改写的 journal 草稿
│
└── .github/
    ├── ISSUE_TEMPLATE/
    │   └── takedown-request.yml  ← 原作者下架申请模板
    └── workflows/
        ├── ci.yml                ← PR / Push 门禁 (audit+check+lint+test+validate)
        └── weekly-takedown-audit.yml ← 每周审计已下架条目图片是否真的不存在
```

## 🔧 采集模式 (双轨架构)

XHS 反爬严格，自动化成功率有限，因此我们提供**两种模式**：

### 模式 A：半人工离线解析 (推荐 · 零风控)
> 适合 70% 以上的笔记，完全合规，不触发任何反爬

```bash
# Step 1: 你自己在浏览器里打开笔记 → Ctrl+S 另存为 → data-raw/html/<任意名>.html
# Step 2: 交给脚本解析
npm run ingest:one -- --html ./data-raw/html/sample-note.html

# 指定平台 (xhs/weibo/ctrip)：
npm run ingest:one -- --platform weibo --html ./data-raw/html/weibo-sample.html
# 不传 --platform 时脚本会从 HTML 内容自动嗅探平台

# 或批量解析一个目录:
npm run ingest:batch -- --html-dir ./data-raw/html/
# 输入清单每行可用 `<platform>:<path|url>` 前缀指定平台，如 `weibo:./data-raw/html/x.html`；无前缀则用 --platform 默认值或自动嗅探
```

### 模式 B：Playwright 浏览器自动化 (可选 · 需登录态)
> 适合需要批量处理的场景，成功率取决于 XHS 风控，可能触发验证码

```bash
npm run ingest:one -- --url "https://www.xiaohongshu.com/explore/abc123"
```

- 脚本自动读取 `https://www.xiaohongshu.com/robots.txt`，Disallow 的路径**拒绝抓取**并提示切回模式 A。
- 默认单线程 + 3 秒间隔，最大并发 `--concurrency 2`（超限会被强制降级）。
- **不持久化任何 Cookie / Token**；Playwright context 关闭即销毁。

## 📥 如何导入到主项目 (ningxia-tourism)

素材库内容**不是发布级数据**，需要编辑人工筛选、重写、二次核对后，以 PR 方式合入主项目：

### Step 1：选定候选笔记，生成编辑套件
```bash
npm run content:kit -- --note <noteId1>,<noteId2>,<noteId3>
# 或全量: npm run content:kit -- --all
```

输出到 `dist/content-kit/`:
1. **`task-cards.md`**：直接拷贝到主项目 `docs/content/MAINTENANCE.md` 的编辑任务清单。
2. **`drafts/<noteId>.md`**：Frontmatter 与主项目 journal 模板 100% 对齐；**正文只有结构化素材点**（不粘贴原文），编辑直接打开后逐段重写。

### Step 2：选图 + 二次核对
- 原图在 sister 仓库的 `images/full/<noteId>/` 下。
- 仅挑选真正需要的 1–2 张图（不是全搬），通过主项目正常 PR 流程合入 `public/images/`（附 provenance）。
- 所有信息必须二次核对（营业时间、门票价格、路线距离等），**不能信 XHS 原文不核实**。

### Step 3：发布标记
- 导入的内容在主项目 `verificationLevel` 只能标 `review`，不能标 `verified`。
- 在 `docs/content/CONTENT_AUDIT.md` 里注明「来源：Minkelxy/ningxia-xhs-scraper noteId=xxx」。

## 🗑️ 下架流程 (原作者权利保护)

如果您是笔记原作者，不希望内容出现在本素材库：

1. 打开 [提交下架 Issue](.github/ISSUE_TEMPLATE/takedown-request.yml)，填写：笔记 URL、作者证明（可选上传截图）、联系邮箱、理由。
2. 或发送邮件到维护者邮箱（见 GitHub profile）。
3. 我们承诺 **24–48 小时 SLA** 内：
   - 标记 `removeRequested=true`，所有导出脚本自动过滤该条。
   - **物理删除** `images/full/<noteId>/` 全部图片。
   - `provenance/manifest.csv` 永久留痕，防止再次误收录。

## 🧪 质量门禁 (CI)

- `npm run ci:local`：一次性跑 `audit → check → lint → test → validate:data`。
- **覆盖率目标**：scripts 目录 ≥ 80% 行覆盖，跑 `npx vitest run --coverage` 查看。

## 📜 Git LFS 使用说明

图片默认使用 Git LFS，避免仓库体积爆炸：

```bash
# 首次 clone 时必须先启用:
git lfs install

# 验证图片走的是 LFS:
git lfs ls-files | head -20

# 如果 images/full/ 超过 200MB，务必确认 .gitattributes 已生效
du -sh images/full/
```

## 🤝 贡献

请先读 [CONTRIBUTING.md](./CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

**最欢迎的贡献方式**：
1. 半人工投喂：把 XHS 笔记「另存为 HTML」→ 发 PR 放进 `data-raw/html/`，我们跑 ingest。
2. 关键词补充：编辑 `config/topics.yaml`，增加你觉得缺的类目。
3. 下架：如果是原作者，走 Issue（不需要 PR）。

## 🔗 与主项目互链

- Sister 仓库（本仓库）：[Minkelxy/ningxia-scraper](https://github.com/Minkelxy/ningxia-scraper)
- 主项目：[Minkelxy/ningxia-tourism](https://github.com/Minkelxy/ningxia-tourism)
- 主项目对接手册：`XHS-SCRAPER-REFERENCE.md`（主项目根目录，含转换脚本与互链规则）

### 主项目对接命令 (xhs-to-content-kit)

```bash
# 1. 生成本地编辑任务卡片（不泄漏原文）→ ../ningxia-tourism/content-kit/EDIT-TASKS.md
npm run content:kit -- \
  --task-list \
  --out-dir ../ningxia-tourism/content-kit

# 2. 仅选某一条 note 生成 journal 草稿 → ../ningxia-tourism/content-kit/journal/<slug>.md
#    草稿与原文相似度 <30%，连续汉字段 <20 字
npm run content:kit -- \
  --note <noteId> \
  --kind journal \
  --out-dir ../ningxia-tourism/content-kit/journal
```

草稿会按照主项目 journal frontmatter 模板生成 100% 对齐字段（id / title / status=review / city / source_xhs_id 等）。
转换过程**完全本地、不上传**；生成的草稿仅包含「词袋+语序打散」后的内容，不含任何原文连续 20 汉字以上片段。

---

## ⚠️ 再次强调 · Compliance Red Lines

1. 素材库内容是**线索来源**，不是原创事实。**绝不**直接 copy-paste XHS 原文到主项目。
2. **绝不**采集评论区 PII（评论内容、用户 ID、头像）。
3. **绝不**声称素材库内容为 verified 级；导入主项目一律标 `review`。
4. **绝不**绕过 robots.txt；Disallow 的路径只用模式 A（半人工离线）。
