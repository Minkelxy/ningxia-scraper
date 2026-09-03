# 塞上江南 · 宁夏旅行地图

> ℹ️ **来源说明**:本页内容由 [`crawl-github-journal.ts`](../../scripts/crawl-github-journal.ts) 从姊妹仓库 [Minkelxy/ningxia-tourism](https://github.com/Minkelxy/ningxia-tourism) 真实抓取并镜像,版权归原作者所有。原文可在 GitHub 直接访问。

| 字段 | 值 |
|------|-----|
| 源仓库 | [Minkelxy/ningxia-tourism](https://github.com/Minkelxy/ningxia-tourism) |
| 源路径 | [`README.md`](https://github.com/Minkelxy/ningxia-tourism/blob/main/README.md) |
| 抓取日期(UTC) | 2026-09-03T05:30:20 |
| 文件大小 | 21132 bytes |
| 源 commit sha | `adffa9b63159` |

---

## 原文内容

[![Deploy](https://github.com/minkelxy/ningxia-tourism/actions/workflows/deploy.yml/badge.svg)](https://github.com/minkelxy/ningxia-tourism/actions/workflows/deploy.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个面向国内游客的**宁夏静态旅行规划站**。网站以自研 SVG 交互地图为核心，串起 5 个地级市、22 个分级核实的公开景点、9 条主题路线、14 道特色美食、15 篇旅行手记专题，并完整保留来源、核实日期与图片许可信息。

> 本站是**开源、非官方**项目，不提供预订或实时票价。景区开放、预约、交通班次和道路耗时可能随时变化，出发前请再次查看景区、场馆或文旅部门官方公告。

在线访问：**[https://minkelxy.github.io/ningxia-tourism/](https://minkelxy.github.io/ningxia-tourism/)**

当前发布快照为 v0.3.118；验收命令与数据规模见 [docs/RELEASE_STATUS.md](docs/RELEASE_STATUS.md)。

---

## ✨ 核心特性

- **自研 SVG 交互地图**：基于宁夏行政区划 GeoJSON，无第三方地图 SDK，支持缩放平移、五市高亮与键盘无障碍；懒加载占位与正式画布共享沙纸色视觉语言，地图层级、控制区和区县图例均提供清晰操作语义，图例支持键盘聚焦联动区域高亮，进入视口后再加载地图数据
- **多图层架构**：行政区域 / 景点 / 美食 / 交通枢纽 / 政府标记，可独立切换；可交互景点与美食点位拥有统一的透明触控热区，并共享键盘聚焦高亮
- **分级核实内容**：每个景点、美食、交通枢纽均标注 `verified` / `review` 等级，附官方来源与核对日期
- **9 条主题路线**：覆盖 1—5 天，含逐日停靠点、时间槽、节奏（relaxed/balanced/intensive）与步行量画像；带 `#route-day-N` 的路线链接可直达对应日程
- **路线详情吸顶节奏**：站点头部、按天导航、日程锚点与 DAY 标记共享响应式间距，桌面端和手机端直接跳转时都避开顶部吸顶层
- **路线详情操作区**：深色头图中的打印、分享与收藏按钮使用同一套半透明深色层级，收藏状态与键盘聚焦反馈保持清晰
- **浅色详情操作区**：美食详情的分享按钮使用独立浅色样式作用域，避免与路线深色头图按钮串色
- **旅行手记搜索**：15 篇资料型专题，支持标题、地点、标签与旅行问题搜索，筛选同步 URL
- **行前指南**：四季建议、跨城原则、装备清单与易变信息核对提醒
- **PWA 离线支持**：首次访问后可在弱网下继续浏览已访问页面和地图数据
- **构建期强校验门禁**：180 天核实周期、占位文本、模板电话、跨引用完整性、图片多格式完整性
- **移动端适配**：响应式布局、收藏页紧凑首屏、收藏列表在 320px—480px 下标题/副标题省略与路线摘要收束、320px—360px 图标化收藏操作、极窄屏品牌栏单行、五城卡片图片按卡片宽度自适应、城市比较表容器内横向滚动、手记栏目窄屏横向浏览、景点卡片在极窄屏保持对比与详情入口单行、带把手与入场动效的底部预览面板、兴趣卡横向滑动、内容页首图 4:3 比例、搜索与路线筛选入口优化，搜索页移动端不自动唤起系统键盘，移动端菜单以实色悬浮面板打开并配合背景遮罩、锁定背景滚动，点击菜单入口后立即收起并将焦点回收到菜单按钮，悬停反馈与桌面导航统一；移动端菜单入口、选择控件、兴趣筛选选中态、地图景点预览动效、路由加载态、公共反馈层安全区、次级行动按钮、安静按钮、文字链接、清除/重置类文字操作、详情返回入口、资料来源入口、搜索清空按钮、筛选面板、路线筛选、行前清除筛选、行前清单进度语义、地图图层选中态、地图层级、首页探索、首页山河主题图形语义、首页内容方法入口、搜索快捷词、内容卡片、阅读入口、资料目录、手记栏目、详情操作、收藏按钮、对比按钮与深色头图按钮聚焦状态统一；桌面与移动导航同步标记当前页面
- **导航与结果区触控规范**：桌面端与移动端品牌首页、搜索、收藏和菜单入口统一保持至少 44px 触控热区（收藏入口隐藏文字后仍保持 44px 宽），景点、路线与美食结果区的清除筛选、搜索清空按钮、搜索快捷关键词、比较结果入口、资料目录和其他控件保持一致的尺寸与聚焦反馈；内容卡片、城市/路线比较表名称入口、比较表“查看”操作入口以及路线详情停靠点名称入口也保持至少 44px 高，表格操作入口同时保持至少 44px 宽
- **收藏与对比**：基于 localStorage 的景点/路线收藏；最多 3 景点横向对比，并保持加入、已选和禁用状态清晰可辨
- **统一搜索页**：`/search` 一键检索景点、美食、城市、路线与旅行专题；搜索与收藏页面遵循单一主内容区域语义，搜索词变化会同步触发页面状态播报
- **统一站点导航**：顶部导航、移动菜单与页脚“继续探索”共用同一组景点、美食、路线、指南、手记和五城入口，资料说明与建议入口单独分组；三处入口共享当前页面路径匹配，统一提供选中态与 `aria-current="page"`，桌面端路径变化后焦点交给新的主要内容，移动端菜单跳转继续回收至菜单按钮，内容卡片、城市/路线比较表名称入口、比较表“查看”操作入口以及路线详情停靠点名称入口保持至少 44px 触控热区
- **来源清晰的配图**：景点、路线、美食、指南、手记、搜索和 404 页面优先使用网络实拍或官方公开图片，并保留来源与许可记录；关于页提供可访问的 GitHub 内容审计记录入口

---

## 🧱 技术栈

| 层级 | 选型 | 版本 | 说明 |
|------|------|------|------|
| 核心框架 | React | 18.3.1 | UI 层 |
| 语言 | TypeScript | ~5.8.3 | 端到端类型安全 |
| 构建 | Vite | 6.4.3 | 构建 + 开发服务器 + 虚拟模块 |
| 样式 | Tailwind CSS | 3.4.17 | 原子化 CSS + 自定义主题 |
| 路由 | React Router DOM | 7.18.2 | SPA 路由，`React.lazy` 代码分割 |
| 地图 | 自研 SVG + GeoJSON | — | WGS84 投影、Pointer Events 缩放平移 |
| 内容渲染 | react-markdown + remark-gfm | 10.1 / 4.0 | 手记 Markdown 渲染（构建时解析） |
| 图标 | lucide-react | 0.511.0 | UI 图标 |
| 工具 | clsx + tailwind-merge | 2.1 / 3.6 | 条件样式合并 |
| 单元测试 | Vitest + Testing Library | 3.2.4 / 16.3 | 逻辑 + 组件测试 |
| E2E 测试 | Playwright | 1.55.0 | 桌面 / 移动端双 viewport |
| 图片处理 | sharp | 0.35.3 | WebP + AVIF 多格式生成 |
| 性能审计 | Lighthouse | 13.4.1 | CI 移动端性能门禁（≥ 0.9） |
| 代码规范 | ESLint + typescript-eslint | 9.39 / 8.67 | 静态检查 |

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 22
- **npm** ≥ 10（或同版本兼容的包管理器）

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/minkelxy/ningxia-tourism.git
cd ningxia-tourism

# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:5173）
npm run dev
```

打开浏览器访问 `http://localhost:5173` 即可预览。

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动本地开发服务器（Vite HMR） |
| `npm run build` | 执行数据校验 → 类型检查 → 生产构建 → 生成 sitemap |
| `npm run verify:pages-fallback` | 校验 GitHub Pages 深层链接回退产物 |
| `npm run preview` | 本地预览构建产物 |
| `npm run validate:data` | 仅运行数据完整性 + 反糟粕门禁 |
| `npm run validate:data:reminder` | 扫描 170—180 天核实周期软提醒（warning-only） |
| `npm run content:lint` | 手记 Markdown / Frontmatter 内容 lint |
| `npm run new:article` | 基于模板快速创建新的手记 Markdown |
| `npm run check` | TypeScript 类型检查（`tsc -b --noEmit`） |
| `npm run lint` | ESLint 全量检查 |
| `npm test` | Vitest 单元测试（单次运行） |
| `npm run test:watch` | Vitest watch 模式 |
| `npm run test:e2e` | Playwright E2E 测试（首次需先安装浏览器） |
| `npm run audit` | 依赖安全审计（`high` 级阻断） |
| `npm run quality:lighthouse` | 移动端 Lighthouse 性能门禁 |
| `npm run process:images` | 批量生成 WebP/AVIF 多尺寸图片 |
| `npm run simplify:map` | 简化 GeoJSON 边界坐标 |

> **首次运行 E2E**：需要先安装 Playwright 浏览器内核
> ```bash
> npx playwright install chromium
> ```

---

## 📁 项目结构

```
ningxia-tourism/
├── .github/workflows/deploy.yml  # CI/CD：校验 → 构建 → GitHub Pages
├── .github/workflows/verification-reminder.yml # 每周核实周期提醒
├── docs/                          # 项目文档（详见 docs/README.md）
│   ├── product/                   # 产品需求、技术架构、开发计划
│   ├── content/                   # 内容审计、图片来源、维护说明
│   └── templates/                 # 手记 / 探店 / 路线模板（不参与发布）
├── public/
│   ├── data/                      # 地图边界 GeoJSON（唯一源）
│   ├── images/                    # 景点 / 美食 / 专题 / AI 示例图片（WebP+AVIF）
│   ├── videos/                    # 宣传视频
│   ├── 404.html                   # GitHub Pages SPA 深层链接回退（Actions 发布）
│   ├── manifest.webmanifest       # PWA 清单
│   ├── sw.js                      # Service Worker（离线缓存）
│   └── robots.txt
├── scripts/                       # 构建辅助脚本（TS，通过 tsx 执行）
│   ├── validate-data.ts           # 数据门禁：JSON 双写、图片、类型安全
│   ├── content-lint.ts            # 手记 Frontmatter lint
│   ├── generate-sitemap.ts        # 构建后 sitemap 生成
│   ├── process-images.ts          # 图片 WebP/AVIF 批量转换
│   ├── run-lighthouse.ts          # Lighthouse 多 URL 审计
│   ├── simplify-geojson.ts        # GeoJSON 边界简化
│   ├── load-journal-files.ts      # Vite 虚拟模块：手记 MD → JS
│   └── new-article.ts             # 新建手记 CLI
├── src/
│   ├── components/
│   │   ├── map/                   # 地图模块（独立图层）
│   │   │   ├── projection.ts      # WGS84 → SVG 投影
│   │   │   ├── useMapViewport.ts  # 缩放 / 平移 Hook
│   │   │   ├── config.ts          # 地图配置、政府标记、键盘工具
│   │   │   ├── MapRegionLayer.tsx # 行政区域图层
│   │   │   ├── AttractionLayer.tsx# 景点图层（role=button，可交互）
│   │   │   ├── FoodLayer.tsx      # 美食图层（有 onSelect 时可交互）
│   │   │   ├── TransportLayer.tsx # 交通枢纽图层（role=img，纯展示）
│   │   │   ├── GovernmentLayer.tsx# 政府标记图层（role=img，纯展示）
│   │   │   ├── MapControls.tsx    # 图层开关控件
│   │   │   └── MapPreview.tsx     # 悬浮预览卡片
│   │   ├── Header / Footer        # 布局组件
│   │   ├── NingxiaInteractiveMap  # 地图根组件
│   │   ├── ResponsiveImage        # 响应式图片（WebP/AVIF 双格式）
│   │   ├── FavoriteButton         # 收藏按钮
│   │   ├── ErrorBoundary          # 错误边界
│   │   ├── SEO                    # 页面 Meta / OG / JSON-LD
│   │   └── ...
│   ├── content/
│   │   ├── journal/               # 旅行手记 Markdown（真实发布源）
│   │   ├── journal-parser.ts      # 构建时解析 + YAML Frontmatter
│   │   ├── journal-search.ts      # 搜索索引
│   │   └── article-templates.ts   # 内容模板解析
│   ├── data/                      # 内容唯一数据源（TS 模块，非 JSON）
│   │   ├── attractions.ts         # 景点：22 published + 草稿
│   │   ├── cities.ts              # 5 个地级市资料
│   │   ├── routes.ts              # 9 条主题路线
│   │   ├── foods.ts               # 14 道特色美食
│   │   ├── transport.ts           # 8 个交通枢纽
│   │   ├── guide.ts               # 行前指南
│   │   ├── discovery.ts           # 4 组旅行兴趣组合
│   │   ├── meta.ts                # 站点元信息
│   │   └── validate.ts            # 数据校验逻辑（ID、时效、引用等）
│   ├── lib/                       # 工具函数与通用 Hook
│   ├── pages/                     # 路由页面（React.lazy 懒加载）
│   ├── types/                     # 全局类型定义
│   ├── test/setup.ts              # Vitest 初始化
│   ├── App.tsx                    # 根组件 + 路由配置
│   ├── main.tsx                   # 应用入口
│   └── index.css                  # 全局样式 + CSS 变量
├── tests/e2e/tourism.spec.ts      # Playwright E2E
├── CONTRIBUTING.md                # 贡献指南
├── README.md
├── package.json
├── vite.config.ts                 # Vite 配置 + 手记虚拟模块插件
├── tailwind.config.js             # Tailwind 主题（沙金 / 胡杨绿 / 枸杞红）
├── eslint.config.js
├── tsconfig.json
├── playwright.config.ts
└── index.html
```

---

## 🧭 路由一览

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | Home | 首页：SVG 地图 + 1—5 天路线匹配 + 最近专题 |
| `/attractions` | AttractionsList | 景点列表（城市 / 类型 / 兴趣筛选） |
| `/attraction/:id` | AttractionDetail | 景点详情（图库、开放信息、来源、周边） |
| `/foods` | FoodsList | 美食列表（分类 / 城市筛选） |
| `/food/:id` | FoodDetail | 美食详情（介绍、餐厅、来源） |
| `/cities` | CityOverview | 五城概览 |
| `/city/:name` | CityOverview | 单城市详情（建议停留、适合人群、提醒） |
| `/routes` | RouteRecommendation | 路线推荐（按天数筛选） |
| `/routes/:routeId` | RouteDetail | 路线详情（逐日停靠 + 时间槽） |
| `/guide` | TravelGuide | 行前指南 |
| `/journal` | Journal | 手记列表（搜索 + URL 联动筛选） |
| `/journal/:type/:slug` | JournalDetail | 手记详情（Markdown 正文 + 来源） |
| `/search` | Search | 统一搜索：景点 / 美食 / 城市 / 路线 / 专题 |
| `/favorites` | Favorites | 我的收藏（localStorage） |
| `/about` | About | 项目介绍 + 信息边界 |
| `/dev/geojson` | GeoJSONViewer | 开发环境：边界查看器 |
| `/dev/editor` | GeoJSONEditor | 开发环境：边界编辑器 |
| `*` | NotFound | 404 |

---

## 🛡️ 构建期数据校验门禁

`npm run validate:data` 在构建期执行；**任一失败都会阻断发布**：

| 门禁项 | 检测内容 |
|--------|----------|
| 🗂️ 重复 JSON 双写 | `src/data/` 与 `public/data/` 不允许同名 JSON 文件 |
| ☎️ 模板化电话 | 拒绝 `0951-12306` 等明显模板填充的号码 |
| 🧷 类型安全削弱 | `src/types/index.ts` 联合类型禁止出现 `\| string` 放宽 |
| 🔢 异常 ID | 所有 `id` 必须匹配 kebab-case ASCII |
| 🏙️ 电话区号匹配 | 交通枢纽电话区号须与所在城市一致 |
| ⏳ verifiedAt 过期 | 超过 **180 天**未复核的条目阻断构建 |
| 📝 占位文本 | 拒绝「示例」「演示用」「待填写」「example.com」等 |
| 🔗 跨数据引用 | 路线 / 兴趣组合只能引用已发布景点 |
| 🖼️ 图片完整性 | 已发布景点 / 手记图片必须具备 WebP + AVIF 两档文件 |

详细字段规范见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 🌐 部署

本站通过 **GitHub Actions** 自动部署到 **GitHub Pages**。流水线位于 [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)，在 `main` 分支 push / PR 时依次执行：

```
依赖安装 → 安全审计 → 数据校验 → 类型检查 → ESLint
      → 单元测试 → Playwright E2E → 生产构建 + sitemap
      → Lighthouse 移动端门禁（≥ 0.9） → 部署 GitHub Pages
```

最近一次构建状态以 [Actions 工作流](https://github.com/Minkelxy/ningxia-tourism/actions/workflows/deploy.yml) 为准；详细说明见 [docs/product/DEPLOYMENT.md](docs/product/DEPLOYMENT.md)。

---

## 🤝 贡献

欢迎贡献数据、代码或文档。完整流程、规范与门禁清单见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

提交 PR 前请确保以下命令全部通过：

```bash
npm run validate:data   # 数据门禁
npm run check           # TS 类型
npm run lint            # ESLint
npm test                # 单元测试
npm run build           # 生产构建
```

如涉及 UI 或交互变更，请额外运行：

```bash
npm run test:e2e        # Playwright E2E
```

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)（`feat:` / `fix:` / `docs:` / `perf:` / `refactor:` / `test:` / `chore:`）。

---

## 📚 文档索引

项目文档全部位于 [`docs/`](./docs/)：

```
docs/
├── README.md                   文档总索引
├── RELEASE_STATUS.md           当前发布快照与验收记录
├── product/                    产品与工程文档
│   ├── 宁夏旅游地图PRD.md          产品需求（功能模块、数据内容、UI 设计）
│   ├── 宁夏旅游地图技术架构.md     技术架构（分层、路由、数据模型、测试、部署）
│   ├── DEVELOPMENT_PLAN.md        开发阶段、里程碑与后续规划
│   ├── DEPLOYMENT.md              部署与 CI/CD 流水线说明
│   └── optimization-7rounds-plan.md  历史 7 轮优化计划（归档）
├── content/                    内容与资产文档
│   ├── CONTENT_AUDIT.md           内容分级审计（景点 / 美食 / 枢纽 / 手记）
│   ├── IMAGE_PROVENANCE.md        实拍/官方图片来源、许可与处理记录
│   ├── MAINTENANCE.md             内容维护日常准则
│   └── attraction-template.json   新增景点数据模板
└── templates/                  内容创建模板（不参与发布）
    ├── editorial-topic.md         资料型旅行专题
    ├── travel-journal.md          亲历游记
    ├── food-journal.md            探店手记
    └── route-template.md          路线规划模板
```

---

## 📄 许可

- 代码：MIT License（详见 [`LICENSE`](./LICENSE)）
- 内容数据：保留来源署名、许可与核实日期；参考图会在 alt 文本中说明，图片规则见 [docs/content/IMAGE_PROVENANCE.md](docs/content/IMAGE_PROVENANCE.md)

---

## 🔗 Sister 仓库 & 素材来源

本项目通过独立 sister 仓库托管多平台公开内容素材候选池（合规可追溯，不直接生产发布级内容）：

- **素材库仓库**：[`Minkelxy/ningxia-scraper`](https://github.com/Minkelxy/ningxia-scraper) · v0.1.0
  - 当前支持小红书，未来将整合微博 / 携程等文字图片内容爬虫
- **主项目对接手册**：[`XHS-SCRAPER-REFERENCE.md`](./XHS-SCRAPER-REFERENCE.md)
  - 包含：选稿 / 生成 journal 草稿 / 下架联动 / Frontmatter 字段映射 / 合规门禁脚本
- **素材 → 发布**转换器：sister 仓库 `scripts/xhs-to-content-kit.ts`
  - 保证生成草稿与原文相似度 < 30%，连续汉字段 < 20 字；绝不泄漏原文
- **原作者下架通道**：在 sister 仓库 Issue 使用「Takedown Request」模板提交，24–48 小时内两侧同步下线

> 如果你希望贡献真实的 XHS 素材（半人工模式 A），请 clone sister 仓库，
> 按 README 指引把 HTML 快照通过 PR 放入 `data-raw/html/`，我们会跑 ingest 入库。

---

## 🌟 致谢

感谢宁夏各级文旅部门公开的景区专页、A 级名录与非遗资料，它们是本项目内容可核实性的基石。

---

← [返回全量目录](./INDEX.md) · [返回总览](../BROWSE.md) · [在源仓库查看原文](https://github.com/Minkelxy/ningxia-tourism/blob/main/README.md)
