# XHS 笔记 HTML 投放区

把小红书笔记页在浏览器里 Ctrl+S 另存为 .html 后放进本目录。
Daily Ingest & Publish 工作流会自动扫到这里的新文件并触发 ingest:batch → dedupe → validate → export-topics → 生成 docs/BROWSE.md → push 回 main。

详见 .github/workflows/daily-ingest-publish.yml。
