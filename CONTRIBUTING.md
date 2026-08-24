# CONTRIBUTING · 贡献规则 (6 条合规红线)

感谢你愿意参与宁夏旅游小红书素材库的建设！为保证**合规、可追溯、不侵犯原作者权益**，所有贡献者（包括维护者本人）必须遵守以下 6 条规则。**不遵守的 PR 会被直接拒绝**。

---

## 🚨 红线 1：不得声称素材为原创
> "这篇攻略是我写的" → ❌ 绝对不行

- 你提交的素材库条目**必须**附 provenance（来源 URL + 作者昵称 + 抓取日期）。
- 不得改写原作者身份，不得把内容伪装成自己的亲历。
- 所有素材库条目 `verificationLevelHint` 固定为 `"reported"`，不允许 PR 改。

---

## 🚨 红线 2：不得直接粘贴原文到主项目
> "复制 XHS 正文 → 改几个字 → 发主项目 PR" → ❌ 绝对不行

- 素材库的 `bodyPlainText` / `bodyHtml` **只能作为编辑参考**。
- 所有发布级内容必须：
  1. 人工通读理解 →
  2. 提取关键事实（时间、价格、路线、店名）→
  3. 100% 用自己的话重写 →
  4. 事实部分二次核对（打电话、官网查、亲测）。
- 验证规则：最长公共子串相似度 > 30% 或连续相同汉字 ≥ 20 的稿件会被打回。

---

## 🚨 红线 3：不得采集 PII
> 爬取评论区内容、评论者 ID/头像、手机号、精确到人的位置 → ❌ 绝对不行

- 仅采集**笔记主体**：标题、正文、话题 tag、公开配图、展示级作者昵称。
- **不要**点进评论区抓取任何东西。
- `geoHint` 只抓笔记正文中提到的城市名/景点名，**不抓用户的精确 GPS 坐标**。

---

## 🚨 红线 4：必须遵守 robots.txt + 反爬约束
> 破解签名、撞验证码、高并发打爆 XHS 服务器 → ❌ 绝对不行

- 自动化 `--url` 模式前先拉 `https://www.xiaohongshu.com/robots.txt`。
- `Disallow` 的路径**拒绝自动化访问**，强制要求改用模式 A（手动另存 HTML 再解析）。
- 请求间隔最小 3 秒；最大并发 2。如果你写了更快的脚本 → 被封 IP 自己负责。
- Playwright **不持久化登录态**到 git 跟踪文件。`.gitignore` 已覆盖所有常规路径。

---

## 🚨 红线 5：必须响应原作者下架请求
> 原作者说"我不希望我的笔记在这里" → ✅ 立即删，24–48 小时 SLA

- 收到下架请求（Issue / Email）后，先执行：
  ```bash
  npm run mark:removed -- --noteId <noteId> --reason "原作者要求" --requester <邮箱或GitHub>
  ```
- 该脚本会：标记 `removeRequested=true` → **物理删除图片** → provenance CSV 留痕。
- 如果图片恢复了（误操作），`weekly-takedown-audit.yml` 会在 CI 里直接 Fail。

---

## 🚨 红线 6：素材发布级 license 必须是 for-reference-only
> 把图片改成 "CC0 自由商用" → ❌ 绝对不行

- Zod Schema 中 `license` 字段是**枚举**，唯一合法值是 `"for-reference-only"`。
- PR 里如果出现放宽 license 的企图（即使是测试数据），直接打回。
- 主项目侧编辑若要引用 sister 仓库的图，必须在 `docs/content/IMAGE_PROVENANCE.md` 登记，且仍然是「参考使用、版权归原作者」。

---

## 📝 提交 PR 的正确流程

### 贡献一条笔记（最常见）
1. 你在浏览器中打开小红书笔记 → Ctrl+S 另存为 HTML。
2. 把 HTML 文件放进 `data-raw/html/`（可以重命名，只要扩展名是 `.html`）。
3. 本地跑：
   ```bash
   npm ci
   npm run ingest:one -- --html data-raw/html/<your-file>.html
   npm run validate:data
   npm run test
   ```
4. 跑通后提 PR。Commit message 建议：
   ```
   feat(seeds): 新增笔记 <noteId> [<topics 关键词>]
   ```

### 贡献脚本 / Schema 改动
1. 写对应的单测 → 行覆盖率 **≥ 80%**。
2. `npm run ci:local` 必须全绿。
3. 如果改动了 Zod Schema：同步更新 `src/schema/note.ts` + `scripts/validate-dataset.ts` + README 目录结构中字段表（如果改了字段）。

### 新增关键词类目
- 编辑 `config/topics.yaml`。
- 跑 `npm run export:topics -- --coverage` 看覆盖率变化。如果本来是 25/25，现在变成 25/26，请顺便补 1 条命中的种子笔记。

---

## ❓ FAQ

**Q: 我可以直接把 XHS 原文翻译（中文改中文，不算 copy）吗？**
A: 不行。相似度检测不看字面，看「最长公共子串 + Simhash」。改几个字或倒装语序依然会被判定相似。正确做法是：记事实点 → 关网页 → 凭理解重写 → 打开网页核对事实。

**Q: 我可以提交视频笔记的截图吗？**
A: 可以。截图和图片一样按 `images/full/<noteId>/` 入库，但要注意：视频帧的 license 同样是 for-reference-only，且你必须附上原笔记 URL provenance。

**Q: 原笔记里有未成年人的脸怎么办？**
A: **不要入库**。即使它公开可见，儿童肖像有额外保护。遇到这类笔记直接跳过。黑名单里可以登记作者，但更建议不要 ingest，不要把正文和图片写进任何文件。
