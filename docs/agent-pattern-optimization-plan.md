# Pi SDK 定制 Agent 范式仓库优化计划

## 1. 文档信息

- 文档状态：已实施（2026-09-08）
- 评审状态：已完成一轮工程审查，已按评审结论收敛范围
- 优化目标：将当前固定的销售数据 Agent 示例演进为易读、简单、方便扩展的 Pi SDK 定制 Agent 范式仓库
- 实施方式：保持外部行为稳定，以可独立验证的微型提交逐步演进
- 质量基线：`npm test`、`npm run typecheck`、`npm run build` 必须持续通过

> 实施记录：P0–P3 已落地；统一入口为 `npm run check`，可重复行为基线为 `npm run eval`。真实 `AgentSession` 工具白名单、project-only 资源隔离、runner 生命周期、模型选择、registry/CLI 和纯查询函数均有契约测试覆盖。最终实现按使用方要求保留 Pi 原生 `read/bash/edit/write`，不使用同名 custom tool 覆盖；仅新增 `query_data`。

## 2. 现状与问题

当前项目已经具备良好的最小分层：Web 和 CLI 共享 `DataAgent`，SDK 事件被转换为稳定的项目事件，HTTP 生命周期、SSE 编码和业务工具基本分离，自动化测试不依赖真实模型。

当前基线为：

- 生产 TypeScript 源码约 500 行。
- Web、交互式 CLI 和单次 CLI 共用同一个 Agent 核心。
- 27 项自动化测试通过。
- 类型检查和生产构建通过。
- 项目资源定位不依赖启动工作目录。

需要解决的问题：

1. Agent 的系统提示词、工具、skill 和模型策略写死在创建函数中，增加第二种 Agent 时容易复制代码或堆积分支。
2. 工具注册必须保留 Pi 原生工具定义，不能通过同名 custom tool 覆盖；真实会话应验证原生工具与新增 `query_data` 的最终组合。
3. 文档对 skill 加载策略存在歧义：一方面允许继承常规 Pi 资源，另一方面又要求全局和父级 skill 不混入。
4. 当前模型选择直接使用第一个可用模型，模型列表顺序变化可能造成行为漂移。
5. `query_data` 同时承担文件读取、过滤、格式化和 SDK Tool 定义，不利于展示数据源替换方式。
6. `DataAgent` 名称绑定具体领域，但其职责实际是通用会话运行器；并发保护也只存在于 HTTP 层。
7. README 主要记录迁移与验收历史，缺少新增 Agent、工具、模型、skill 和入口的扩展指南。

## 3. 设计原则

### 3.1 简单优先

- 不引入依赖注入容器、事件总线或动态插件框架。
- 只抽象已经存在的变化点：Agent 定义、模型选择、工具组合、skill 策略和运行时适配。
- 一个新 Agent 应能通过新增定义完成，不修改 Web、CLI 或 Pi SDK 适配层。
- Agent 定义直接使用 Pi SDK 的工具类型，不为 SDK 已有能力再建立一套包装协议。
- 优先使用 Pi SDK 内置的工具白名单、模型运行时和会话状态能力。

### 3.2 依赖方向单一

```text
Web / CLI 等入口
       │
       ▼
AgentRunner + StreamEvent
       │
       ▼
AgentDefinition
       │
       ▼
Pi SDK + tools + resources
```

- 入口层只依赖项目自己的接口和事件类型。
- Agent 定义声明 prompt、tools、skills 和模型要求，不直接管理 SDK 会话。
- Pi SDK 类型不泄漏到 Web 和 CLI。
- 工具的领域逻辑尽量保持为可独立测试的纯函数。

### 3.3 小步实施

- 每个提交只完成一个可描述的结构变化。
- 重构提交不同时改变外部行为。
- 行为变化必须先增加契约测试。
- 任意提交完成后项目都应可测试、可构建。

## 4. 目标架构

第一轮只形成以下最小模块职责：

```text
src/
├── agent/
│   ├── definition.ts
│   ├── runner.ts
│   └── sales-agent.ts
├── tools/
│   └── query-data.ts
├── events.ts
├── sse.ts
├── server.ts
├── paths.ts
├── index.ts
└── cli.ts
```

核心抽象保持最小：

```ts
interface AgentDefinition {
  id: string;
  description: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  activeToolNames: string[];
  requiredSkillNames?: string[];
  model?: {
    provider: string;
    id: string;
  };
}

interface AgentRunner {
  readonly metadata: AgentMetadata;
  prompt(input: string, emit: EventHandler, signal?: AbortSignal): Promise<void>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
}
```

`AgentDefinition` 是无状态声明，`AgentRunner` 负责封装 Pi SDK 的会话、事件订阅、并发、取消和释放。

本轮不预建 `SingleSessionChatService`、repository class、独立错误模块或 transport 目录。只有出现第二种真实实现并产生重复后，才继续拆分。

## 5. 分阶段实施计划

### P0：修复工具权限与文档契约

目标：先确保实际运行时的安全边界与文档一致。

任务：

1. 增加真实会话工具清单的契约测试，使用 `getActiveToolNames()` 和 `getAllTools()` 确认工具集合、定义与来源。
2. 使用 Pi SDK 的 `tools` 白名单建立确定性权限，不自建权限框架。
3. 明确基础工具策略：
   - 数据分析 Agent 默认仅启用完成任务所需的工具；
   - 编码型 Agent 如需 `bash`、`edit`、`write`，必须在自己的定义中显式声明。
4. 数据分析 Agent 的确定性配置为：
   - `tools: ["read", "bash", "edit", "write", "query_data"]`；
   - `customTools: [queryDataTool]`，不覆盖 Pi 原生工具。
5. 增加集成测试，证明真实会话：
   - 可以读取目标 skill 正文与 references；
   - `read`、`bash`、`edit`、`write` 均来自 Pi 原生工具定义；
   - `query_data` 是唯一新增的 custom tool。
   - extension 或其他资源不能扩大启用工具集合。
6. 明确 skill 资源模式：
   - 默认采用 `project-only`，确保示例可重复；
   - 如确有需要，显式提供 `inherit-user-resources` 可选模式。
7. 调查并消除测试期间出现的 skill 名称 warning，或将其纳入明确的非致命诊断策略。
8. 修订 README，使运行行为、安全约束和测试声明一致。

验收标准：

- 真实 AgentSession 的工具权限由集成测试覆盖。
- 默认模式不会意外继承未声明的工具或 skill。
- 活动工具精确等于 Agent 定义中的白名单。
- 启动时输出明确的资源加载策略。
- 文档不再包含互相冲突的隔离描述。

### P1：引入声明式 Agent 定义

目标：新增 Agent 时只组合配置和领域能力，不修改基础设施。

任务：

1. 新增通用 `AgentRunner` 接口。
2. 暂时保留 `DataAgent` 类型别名，避免大范围同步修改。
3. 新增最小 `AgentDefinition`，初始只包含标识、描述和系统提示词。
4. 将销售分析系统提示词移动到 `salesAgentDefinition`。
5. 将 `query_data` 和活动工具白名单移动到销售 Agent 定义，保留 Pi 原生工具实现。
6. 将目标 skill 和资源策略移动到 Agent 定义。
7. 新增通用 `createAgentRunner(definition, runtimeConfig)`。
8. 将 `createDataAgent()` 改为创建销售 Agent 的兼容薄封装。
9. 用测试证明两个不同定义可复用同一 runner 工厂。

`AgentDefinition` 直接使用 Pi SDK 的 `ToolDefinition`。本仓库的目标是教授 Pi SDK 定制方式，不为工具 schema、执行上下文和返回结果复制一套中间类型。Pi SDK 类型只需要与 Web 和 CLI 隔离。

验收标准：

- 新增第二个 Agent 不需要修改 Pi SDK adapter、Web 或 CLI。
- Agent 定义不持有运行时状态。
- 现有 Web、CLI 和 SSE 对外行为保持不变。

### P1：显式化模型和运行配置

目标：消除“第一个可用模型”带来的隐式行为。

任务：

1. 使用 `{ provider, id }` 精确选择模型，不建立复杂的 selector 类层次。
2. 支持通过 `PI_PROVIDER` 和 `PI_MODEL` 显式选择模型。
3. 集中解析 `agentDir`、模型、资源模式、host 和 port 等运行配置。
4. 锁定模型选择规则：
   - 同时配置 provider 和 model 且精确命中时使用该模型；
   - 显式配置无法命中时启动失败；
   - 未显式配置且恰好只有一个可用模型时使用该模型；
   - 未显式配置且存在零个或多个可用模型时启动失败，并列出可用候选。
5. 为模型不存在、没有认证、配置非法定义可理解的错误类型和提示。
6. 增加纯配置测试，不连接真实 provider。

验收标准：

- 启动日志明确显示 Agent ID、provider、model 和资源模式。
- 模型列表排序变化不会静默改变实际模型。
- 不允许只用模型名称在多个 provider 之间进行含糊匹配。
- 配置错误在创建 HTTP Server 或 CLI 循环前失败。

### P1：统一 Runner 生命周期

目标：让 Web、CLI 和未来入口共享相同的并发、取消与释放语义。

任务：

1. 使用底层 AgentSession 的运行状态作为并发判断的唯一事实来源，避免 HTTP 和 runner 分别维护 busy 状态。
2. 仅为入口层必须区分的失败定义稳定错误码或错误类型，例如 busy、disposed 和 configuration；不为每种内部异常建立类。
3. 将 `abort()` 规范为异步方法，正确等待或处理 SDK 中止结果。
4. 为 `prompt()` 增加可选 `AbortSignal`。
5. 确保每次 prompt 只建立一个 SDK 订阅，并在成功、失败和取消路径全部退订。
6. HTTP 层只负责把 runner 错误映射为对应状态码。
7. 增加重复 dispose、prompt/abort 竞态、断线和订阅清理测试。

验收标准：

- Runner 脱离 HTTP 使用时也能阻止并发 prompt。
- 并发状态不存在两份可能失同步的布尔值。
- HTTP 和 CLI 使用同一取消机制。
- 所有测试完成后没有残留订阅、定时器或 Server 句柄。

### P2：拆分 `query_data` 领域工具

目标：在不增加目录跳转成本的前提下，清楚展示领域逻辑和 SDK 包装的边界。

任务：

1. 先建立当前工具输出的兼容测试。
2. 在现有文件内提取 CSV 解析纯函数。
3. 提取带明确操作符联合类型的查询纯函数。
4. 提取结果格式化纯函数。
5. SDK Tool 定义只负责参数 schema、工具描述和调用上述函数。
6. 测试通过字符串或函数参数注入数据，不提前引入 repository 接口或 class。
7. 明确 CSV 能力边界：
   - 若保持教学用途，文档声明不支持完整 CSV 转义；
   - 若需要通用能力，引入成熟 CSV parser，并增加引号、逗号和换行测试。
8. 补充空数据、重复表头、非法 limit 和数值边界测试。

验收标准：

- 文件读取、CSV 解析、查询规则、结果格式和 SDK Tool 定义可独立测试。
- 只有出现第二种真实数据源时才提取 repository 接口。

### P2：收敛事件适配与请求生命周期

目标：入口层不依赖 Pi SDK 事件结构。

任务：

1. 保持 SDK 事件转换集中在一个模块，不急于建立 `pi/` 目录层次。
2. SSE 编码与 SDK 事件转换保持为独立纯函数，必要时再分文件。
3. CLI 和 Web 继续只消费 `StreamEvent`。
4. 只有当前 HTTP 闭包在改造后仍难以测试或出现重复清理逻辑时，才提取 request lifecycle 对象。
5. 不建立 `SingleSessionChatService`；当前单共享会话策略继续由 server 与 runner 的清晰契约表达。
6. 不预留未被使用的多会话接口。
7. 增加入口契约测试，验证同一事件在 CLI 与 Web 中含义一致。

验收标准：

- SDK 升级导致事件结构变化时，修改范围集中在事件转换函数及其测试。
- 本阶段不以假设中的 WebSocket 或框架替换驱动目录结构。

### P2：完善范式仓库文档和示例

目标：让开发者无需理解全部基础设施就能增加自己的 Agent。

任务：

1. 将 README 首页调整为：项目定位、30 秒启动、架构、扩展入口和安全边界。
2. 新增“创建 Agent”指南。
3. 新增“创建工具”指南。
4. 新增“选择模型与 provider”指南。
5. 新增“配置 skills 与工具权限”指南。
6. 新增“增加 transport”指南。
7. 将迁移历史移动到独立历史文档。
8. 增加一个不带销售业务依赖的最小第二 Agent，用于证明扩展路径。
9. 增加最小 Agent registry，并让 CLI 支持 `--agent <id>`；Web 继续使用明确配置的默认 Agent。
10. 确保文档中的 TypeScript 示例被 typecheck 或测试覆盖。

验收标准：

- 开发者可按文档在一个新模块内完成第二个 Agent。
- 扩展过程不要求修改通用 runner、Web 或 CLI。
- 第二个 Agent 能通过 CLI 被真实选择和执行，而不是只存在于测试中。
- README 主线不再被历史迁移细节打断。

### P3：工程质量补强

目标：让后续扩展可持续，但不增加不必要的开发负担。

任务：

1. 增加轻量 lint 和 format 配置。
2. 增加 `npm run check`，聚合测试、类型检查和构建。
3. 在 CI 中运行 `npm run check`。
4. 增加 Node 最低版本检查。
5. 增加 Pi SDK 升级兼容测试，重点覆盖事件转换、模型选择和工具注册。
6. 增加最小 LLM eval 套件，覆盖系统提示词、工具选择、答案数据一致性和越权拒绝。
7. 仅在需要把仓库作为模板分发时，再增加初始化脚本和示例删除选项。

验收标准：

- 一个命令可以完成本地提交前检查。
- CI 与本地使用同一质量入口。
- SDK 升级中的主要破坏性变化能由契约测试发现。
- prompt、skill 或工具描述变化造成的行为退化能由 eval 发现。

## 6. 微型提交序列

评审后将原 23 步收敛为以下 14 个逻辑提交。每个提交完成后运行质量基线命令：

1. 增加真实 AgentSession 的工具来源与权限契约测试。
2. 使用 `tools` 白名单保留 Pi 原生工具并注册 `query_data`，不做同名覆盖。
3. 明确并测试 project-only 资源策略，清理 diagnostics warning。
4. 引入最小 `AgentDefinition`，直接使用 Pi SDK `ToolDefinition`。
5. 提取 `salesAgentDefinition`，包含 prompt、工具、skill 和活动工具白名单。
6. 引入通用 runner 工厂，并保留原工厂作为兼容薄封装。
7. 增加 provider + model 的确定性选择和集中配置校验。
8. 统一 runner 的订阅、取消、释放和基于 session 状态的并发判断。
9. 在原工具文件内提取 CSV 解析、查询和格式化纯函数。
10. 收敛 SDK 事件转换、SSE 编码和请求清理职责，不预建额外目录层次。
11. 增加 Agent registry 和 CLI `--agent` 选择。
12. 增加第二个最小 Agent 及扩展指南。
13. 增加 prompt/tool eval，覆盖数据一致性和越权拒绝。
14. 增加统一检查命令和 CI。

## 7. 测试决策

好的测试应验证外部行为和架构契约，而不是锁死私有实现细节。

重点测试范围：

- Agent 定义能否被同一 runner 工厂加载。
- 真实会话最终启用的工具名称和权限。
- project-only 与继承资源模式的差异。
- 模型选择不受返回顺序影响。
- provider 与 model 联合选择，不允许同名模型误匹配。
- prompt 并发、取消、失败和释放语义。
- Pi SDK 事件到项目事件的转换。
- CSV 解析、查询规则和格式化输出。
- HTTP、SSE、CLI 对统一事件协议的消费。
- 跨工作目录运行和构建产物资源定位。
- Agent registry 的默认选择、显式选择和未知 ID。
- CLI 参数解析能正确区分 `--agent` 与问题正文。

涉及系统提示词、skill 或工具描述的变化还必须运行 LLM eval。初始固定案例至少包括：

- 单条件销售查询；
- 跨地区比较；
- 不存在的列；
- 数据不足时拒绝编造；
- 需要读取项目 skill 的开发问题；
- 诱导 Agent 绕过工具或读取敏感文件。

eval 应检查是否调用预期工具、工具参数是否正确、答案数字是否与工具结果一致，以及越权读取没有发生。

继续沿用现有测试风格：

- 默认不连接真实模型。
- Agent、数据输入函数、输入输出流均可注入 fake。
- 网络测试使用随机本地端口并在 finally 中关闭资源。
- 安全边界需要测试真实组合结果，不能只单测未接入生产路径的工具。

## 8. 实施完成定义

全部优化完成时应满足：

1. 增加新 Agent 只需定义 prompt、tools、skills 和模型策略。
2. Web 与 CLI 不包含销售领域或 Pi SDK 专属逻辑。
3. 所有工具权限均可从 Agent 定义或运行配置中明确看到。
4. 默认资源和模型选择具有确定性。
5. 数据源、查询逻辑、格式化和 SDK Tool 包装职责分离。
6. 取消、并发和释放行为在所有入口一致。
7. README 能引导开发者独立完成 Agent、工具和入口扩展。
8. `npm run check` 在支持的 Node 版本上稳定通过。
9. 第二个 Agent 可以通过 CLI registry 被实际执行。
10. prompt、skill 和工具描述的核心行为具有可重复的 eval 基线。

## 9. 非目标

本轮不实施：

- 多租户身份与权限系统；
- 会话数据库持久化；
- 分布式任务队列；
- 动态插件市场；
- 完整可观测性平台；
- 更换 Express 或前端框架；
- 多包 monorepo；
- 为潜在需求预建依赖注入容器；
- 为尚不存在的第二种数据源预建 repository class；
- 为尚不存在的 WebSocket 或框架迁移预建 transport 层；
- 自建一套与 Pi SDK `ToolDefinition` 重复的工具协议。

这些能力只有在出现明确使用场景后，才应基于已有稳定接口继续演进。

## 10. 推荐实施顺序

优先完成 P0 和 P1。它们会先修复真实的权限契约风险，再建立 Agent 定义、模型配置和生命周期三条关键扩展边界。

P2 用于把当前项目从完成度较高的销售 Agent 示例提升为可复制的范式仓库。P3 应在核心抽象稳定后进行，避免工程工具配置干扰主要结构调整。
