# Skill 维护流程

升级 `@earendil-works/pi-coding-agent` 前后按以下流程维护本 skill：

1. 记录当前基线版本与目标版本。
2. 阅读目标版本 `packages/coding-agent/CHANGELOG.md`，列出 breaking changes。
3. 安装目标版本后，以其 `dist/**/*.d.ts` 为权威逐项核对本文档中的导入、类型、参数与事件。
4. 更新受影响的场景文档和 SDK reference，并运行全部示例或契约测试。
5. 更新 `SKILL.md` 顶部版本基线，在本地 `CHANGELOG.md` 记录差异。

不得仅根据旧版 `node_modules` 推断新版 API，也不得在未核对类型定义时把基线标为已升级。
