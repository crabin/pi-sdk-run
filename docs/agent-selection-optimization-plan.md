# Web 与 CLI Agent 选择功能优化计划

## 1. 文档信息

- 文档状态：已实施（2026-09-08）
- 制定日期：2026-09-08
- 优化目标：允许 Web 和交互式 CLI 从现有 Registry 中选择不同 Agent
- 设计定位：保持 Pi SDK 范式项目简单、声明式、易复制，不引入持久化、前端框架或复杂状态管理
- 质量基线：`npm run check` 必须通过

## 2. 当前项目基线

项目已经具备实现 Agent 选择所需的核心结构：

- `src/agent/registry.ts` 是 Agent 的唯一注册入口，当前包含 `reach`、`sales` 和 `minimal`。
- `createAgentRunner(definition)` 已封装 Pi SDK 会话、模型、工具和资源加载。
- Web 与 CLI 共用 `AgentRunner` 和 `StreamEvent`，入口层不依赖 Pi SDK 原始事件。
- CLI 已支持启动参数 `--agent <id>`，但进入交互模式后不能切换。
- Web Server 启动时只创建一个固定 Agent，浏览器无法获取或选择 Registry 中的其他 Agent。
- 每个 Runner 使用内存会话，项目定位是本地单用户 SDK 示例。

本次只补充 Agent 发现、选择和生命周期管理，不改变 `AgentDefinition`、流式事件或工具权限模型。

## 3. 设计原则

1. Agent 列表只来源于 `agentRegistry`，Web 和 CLI 不维护重复配置。
2. 按需创建 Runner，未使用的 Agent 不增加启动成本，也不提前触发模型或资源校验。
3. 每个 Agent 对应一个 Runner 和一份独立的内存会话；切换回来时可继续该 Agent 的上下文。
4. Transport 只传递和选择 `agentId`，不包含领域逻辑或 Pi SDK 初始化细节。
5. 保留现有 `--agent <id>` 和未传 `agentId` 的行为，确保向后兼容。
6. 使用原生 HTML、CSS 和 JavaScript，不引入前端框架或全局状态库。

## 4. 目标结构

```text
Web / CLI
    │ 选择 agentId
    ▼
AgentManager
    │ 查询定义、创建或复用 Runner
    ▼
Agent Registry → AgentDefinition → AgentRunner → Pi SDK Session
```

`AgentManager` 是本次唯一新增的共享抽象。它只负责 Agent 的发现、Runner 获取和统一释放，不处理 HTTP、SSE、终端命令或页面状态。

## 5. 实施计划

### 5.1 Registry 增加只读列表能力

在 `src/agent/registry.ts` 增加一个只读查询函数，例如：

```ts
export interface AgentSummary {
  id: string;
  description: string;
}

export function listAgents(): AgentSummary[];
```

约束：

- 返回顺序沿用 Registry 声明顺序。
- 只暴露界面需要的 `id` 和 `description`，不向浏览器泄漏 system prompt、工具定义等运行细节。
- 未知 ID 继续由 `getAgentDefinition()` 统一报错。
- 新增 Agent 时仍只需向 Registry 注册一次。

### 5.2 增加轻量 AgentManager

在 `src/agent/` 下新增一个小型管理器，建议接口如下：

```ts
class AgentManager {
  list(): AgentSummary[];
  get(id?: string): Promise<AgentRunner>;
  dispose(): Promise<void>;
}
```

职责：

- 未传 ID 时使用 `defaultAgentId`。
- 第一次选择某个 Agent 时调用 `createAgentRunner()`。
- 后续选择同一 Agent 时复用 Runner。
- 并发请求同一尚未创建的 Agent 时复用同一个创建 Promise，避免重复会话。
- 创建失败时不缓存失败结果，允许后续重试。
- `dispose()` 幂等释放所有已创建 Runner。

不在管理器中加入 LRU、超时回收、持久化或用户隔离。

### 5.3 Web Server 支持 Agent 列表和选择

新增接口：

```http
GET /agents
```

返回：

```json
{
  "defaultAgentId": "reach",
  "agents": [
    { "id": "reach", "description": "..." },
    { "id": "sales", "description": "..." },
    { "id": "minimal", "description": "..." }
  ]
}
```

扩展聊天请求：

```http
POST /chat
Content-Type: application/json

{
  "agentId": "sales",
  "message": "华东地区销售情况如何？"
}
```

服务端行为：

- `message` 沿用现有非空字符串校验。
- `agentId` 未传时使用默认 Agent，保持旧客户端兼容。
- `agentId` 不是字符串或 Registry 中不存在时返回 `400` JSON 错误，不启动 SSE。
- 从 `AgentManager` 获取对应 Runner，再复用现有 prompt、取消、心跳、错误和单一 `done` 逻辑。
- busy 状态按目标 Agent 判断；不同 Agent 拥有彼此独立的 Runner。
- Server shutdown 时终止活动请求，并由 `AgentManager.dispose()` 统一释放 Runner。

Web 启动参数 `--agent <id>` 保留，并作为页面初始选择的 Agent；它不再限制服务器只能使用一个 Agent。

### 5.4 Web 顶栏增加下拉框

将页面顶栏调整为三段布局：

```text
DataAgent · 流式对话    [ Agent 下拉框 ]    ● 就绪
```

页面行为：

1. 初始化时请求 `GET /agents`。
2. 根据返回内容生成原生 `<select id="agent">`。
3. 默认选中服务端给出的初始 Agent。
4. 发送消息时在 `/chat` 请求体中带上当前 `agentId`。
5. 请求流式执行期间禁用下拉框，结束、停止或失败后恢复。
6. 选择变化时更新辅助说明，展示当前 Agent 的描述。
7. Agent 列表加载失败时显示安全错误，并禁用发送，避免请求目标不明确。

切换 Agent 默认不清空页面已有消息，只影响后续提问。页面仍保持单一、线性的演示聊天界面。

### 5.5 CLI 增加 `/agent` 命令

保留当前启动方式：

```bash
npm run cli -- --agent sales
npm run cli -- --agent minimal "解释什么是流式响应"
```

交互模式新增：

```text
/agent
```

用于显示当前 Agent 和可用 Agent 列表；切换使用：

```text
/agent sales
```

命令规则：

- 只有整行以 `/agent` 命令格式出现时才解析，普通问题内容不受影响。
- `/agent` 显示当前项及所有候选的 ID、描述。
- `/agent <id>` 获取或创建对应 Runner，成功后更新当前 Agent。
- 未知 ID 输出错误和可用 ID，但不退出交互循环。
- 多余参数输出简短用法提示。
- 普通问题始终发送给当前 Agent。
- 切换回来时复用该 Agent 原有 Runner 和上下文。
- CLI 退出时统一释放所有已经创建的 Runner。
- 单次问答模式仍只使用启动时选定的 Agent，不执行交互命令解析。

为保持可测试性，交互循环依赖最小的 Agent provider/manager 接口，不直接创建真实 Pi SDK 会话。

### 5.6 文档与导出更新

- 从 `src/agent/index.ts` 聚合导出 Registry 查询与 AgentManager。
- 更新 README 的 Web 和 CLI 示例。
- 补充 `GET /agents` 及新版 `POST /chat` 契约。
- 说明 Agent Registry 是 Web 和 CLI 的唯一选项来源。
- 说明不同 Agent 使用独立内存上下文，但项目不提供用户级隔离或持久化。

## 6. 测试计划

### 6.1 Registry 与 AgentManager

- 列表包含所有已注册 Agent，默认 ID 正确。
- 同一 ID 多次获取只创建一个 Runner。
- 不同 ID 创建不同 Runner。
- 并发获取同一 ID 不重复创建。
- 未知 ID 返回明确错误。
- 创建失败后可以重试。
- `dispose()` 幂等，且每个已创建 Runner 只释放一次。

### 6.2 Web Server

- `GET /agents` 返回默认 ID 和安全摘要。
- `/chat` 将消息发送给指定 Agent。
- 未传 `agentId` 时使用默认 Agent。
- 非法或未知 `agentId` 返回 400。
- 同一 Agent 忙时返回 429。
- 不同 Agent 的 Runner 和上下文相互独立。
- shutdown 终止活动请求并释放所有已创建 Runner。
- 现有心跳、断线取消、错误事件和单一 `done` 契约继续通过。

### 6.3 Web 页面

- 初始化请求并渲染 Agent 下拉框。
- 默认 Agent 被正确选中。
- `/chat` 请求体包含当前选择的 `agentId`。
- busy 时下拉框禁用，完成或失败后恢复。
- Agent 列表加载失败时显示错误并阻止发送。

### 6.4 CLI

- `/agent` 列出当前 Agent 和候选项。
- `/agent sales` 正确切换。
- 普通问题发送给当前 Agent。
- 切换回来复用原 Runner。
- 未知 Agent 不终止交互。
- 退出时释放所有已创建 Runner。
- 原有 `--agent`、单次问答和退出码测试继续通过。

完成后执行：

```bash
npm run check
```

## 7. 推荐实施顺序

1. 为 Registry 列表和 AgentManager 补充契约测试并实现。
2. 改造 Server，增加 `/agents` 和按 `agentId` 路由的 `/chat`。
3. 更新 Web 顶栏、页面初始化和请求体。
4. 改造交互式 CLI，加入 `/agent` 命令。
5. 更新 README，运行完整质量检查。

每一步完成后均保持测试和类型检查通过，避免同时修改 SDK 适配、Transport 和 UI 后难以定位回归。

## 8. 非目标

本轮不实现：

- Agent 配置的运行时增删改。
- Agent 或聊天历史持久化。
- 每个浏览器、用户或标签页独立的服务端会话。
- Agent 与模型的二级联动选择。
- 正在流式执行时强制切换或迁移上下文。
- Runner 数量限制、LRU 或空闲超时回收。
- React、Vue 等前端框架或客户端状态库。

这些能力会显著扩大示例的结构和语义，不符合当前仓库作为 Pi SDK 简明范式的目标。

## 9. 完成定义

满足以下条件即可认为本轮优化完成：

1. Web 顶部中间可以选择所有已注册 Agent。
2. Web 后续消息由所选 Agent 处理，流式显示、停止和错误处理正常。
3. 交互式 CLI 可用 `/agent` 查看和切换 Agent。
4. 新增 Agent 后，Web 和 CLI 无需额外维护选项列表。
5. 不同 Agent 使用独立、可复用的 Pi SDK 内存会话。
6. 现有 `--agent` 和默认 Agent 行为保持兼容。
7. Server 与 CLI 退出时正确释放所有 Runner。
8. `npm run check` 全部通过。
