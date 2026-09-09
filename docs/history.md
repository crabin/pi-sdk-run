# 项目历史

本项目最初从 `pi_sdk_learn/code/L07-streaming` 教学示例迁出，保留 Express SSE、浏览器安全渲染、CLI、项目内销售数据和 `dg-piagent` skill。迁移清单与源文件摘要位于 `docs/skill-migration/`，原始实施记录位于 `docs/implementation-plan.md`。

随后按 `docs/agent-pattern-optimization-plan.md` 演进为声明式 Agent 范式：工具由定义中的白名单显式管理，同时保留 Pi 原生基础工具、不以同名 custom tool 覆盖；资源默认 project-only；模型改为 provider/id 确定性选择；会话生命周期集中到 runner；销售查询拆成可注入纯函数；加入 registry、第二个 Agent、扩展指南、eval 与统一 CI 检查。
