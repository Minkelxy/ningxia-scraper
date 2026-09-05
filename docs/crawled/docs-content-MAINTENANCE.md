# 内容维护说明

> ℹ️ **来源说明**:本页内容由 [`crawl-github-journal.ts`](../../scripts/crawl-github-journal.ts) 从姊妹仓库 [Minkelxy/ningxia-tourism](https://github.com/Minkelxy/ningxia-tourism) 真实抓取并镜像,版权归原作者所有。原文可在 GitHub 直接访问。

| 字段 | 值 |
|------|-----|
| 源仓库 | [Minkelxy/ningxia-tourism](https://github.com/Minkelxy/ningxia-tourism) |
| 源路径 | [`docs/content/MAINTENANCE.md`](https://github.com/Minkelxy/ningxia-tourism/blob/main/docs/content/MAINTENANCE.md) |
| 抓取日期(UTC) | 2026-09-05T05:18:05 |
| 文件大小 | 3300 bytes |
| 源 commit sha | `13dfc13ee9f6` |

---

## 原文内容

1. 景点、城市和路线只在 `src/data/attractions.ts`、`cities.ts` 和 `routes.ts` 中维护，不再复制 JSON 副本。
2. 新景点先以 `draft` 加入，完成字段、来源和图片许可核对后再改为 `published`。
3. 坐标统一使用 WGS84；县区写入 `locality`，地级市只能使用五个固定 `cityId`。
   每座城市还必须维护 `suggestedStay`、`arrivalNote`、`bestFor` 和 `planningTip`，用于五城比较与详情页决策卡；这些字段应写成稳定的编辑建议，避免未经来源支撑的精确交通耗时。
4. 路线中的正式景点必须引用现有 `attractionId`；夜市、酒店等普通地点必须填写 `mapQuery`。
   每条路线还必须维护 `pace`、`walkingLevel` 和 `transportSummary`，用于路线筛选、横向比较和详情页体力提示。
5. 每次修改后先运行 `npm run validate:data`，再运行 `npm run check && npm test && npm run build`。
6. 票价、开放时间、预算和交通时间属于易变信息，更新时同步修改 `verifiedAt` 与来源的 `checkedAt`，并准确标记来源层级及其支持的字段范围。
7. 图片必须是原创、公共领域或明确的 Creative Commons 授权文件；详情页需要展示图片说明、作者、许可和原始页面。区域氛围图可以使用，但必须明确标注为非景点实景。
8. 游记、探店与资料专题使用 `docs/templates/` 中的模板，完成后复制到 `src/content/journal/`；亲历内容必须使用 `contentKind: firsthand`，资料专题必须使用 `type: guide` 与 `contentKind: editorial`。
9. 公开手记必须使用真实素材，封面与图集放在 `public/images/journal/` 并生成 WebP/AVIF 多尺寸版本。草稿不会进入列表、详情或站点地图。
10. 探店的人均、排队、地址和营业信息必须绑定 `visitedAt`；个人体验不使用星级或数字评分。
11. 证据等级变更后同步更新 `docs/content/CONTENT_AUDIT.md`。`verified` 取决于核心文字事实和位置是否有直接、可追溯来源；政府首页级来源或事实缺口不能通过核实，已明确说明的区域氛围图不单独影响等级。
12. 演示内容必须使用 `contentKind: demo` 并保持 `draft`；正式手记的图片须存入 `public/images/journal/{slug}/`，发布日期与更新日期不得早于实际行程或到店日期。
13. 资料专题不得写成亲历口吻，至少提供两个可访问来源、逐项核对日期、适用范围和关键判断；可以复用许可清晰的景点图片，但仍须保留原始署名。
14. 正式地图边界只维护 `public/data/ningxia-province.json` 与 `public/data/ningxia/districts/`；开发查看器复用同一数据，不再提交地图截图、源码内 JSON 副本或未被页面读取的转换产物。
15. 景点兴趣组合只在 `src/data/discovery.ts` 维护，每组至少引用 3 个已公开景点；草稿景点、重复引用和失效 ID 会阻止构建。
16. GitHub Pages 工作流使用官方 Action 主版本（当前为 checkout/setup-node v7、Pages artifact/deploy v5）；项目构建运行时为 Node.js 22。升级 Action 或 Node 后必须在 PR 上完整通过数据、端到端、构建与 Lighthouse 门禁，不能只依据版本号判断兼容。

---

← [返回全量目录](./INDEX.md) · [返回总览](../BROWSE.md) · [在源仓库查看原文](https://github.com/Minkelxy/ningxia-tourism/blob/main/docs/content/MAINTENANCE.md)
