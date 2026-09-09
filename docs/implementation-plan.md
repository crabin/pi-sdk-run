# L07 Streaming 独立项目总体实施计划

> 历史说明：这是初始迁移记录。其“受限 read 覆盖”设计已被当前实现取代；销售 Agent 保留 Pi 原生工具，唯一新增 custom tool 是 `query_data`。当前契约以 README 和 Agent 范式优化计划的实施记录为准。

## 1. 文档信息

- 目标目录：`pi-agent/pi-sdk-run`
- 迁移来源：`pi-agent/pi_sdk_learn/code/L07-streaming`
- 文档状态：已实施并验收
- 实施结果：源码迁移、独立依赖、构建、自动化测试、真实模型及仓库外部署验证均已完成

## 2. 目标与完成定义

把第 7 章流式 Web 示例重构为一个可独立复制和运行的 TypeScript 项目：默认启动 Web 服务，同时提供交互式与单次问答 CLI。Web 和 CLI 必须共享 DataAgent、`query_data`、项目私有 skills 和统一的流式事件翻译，不形成两套行为不同的实现。

“真正独立”同时满足以下条件：

1. `pi-sdk-run` 内拥有自己的 `package.json`、锁文件、TypeScript 配置、源码、数据、skills、静态页面、测试和文档。
2. 生产代码及 npm scripts 不引用仓库根级或 `pi_sdk_learn/code` 下的文件、依赖或配置。
3. 资源定位不依赖调用者的当前工作目录。
4. 从项目目录、仓库根目录通过 `npm --prefix`、以及项目目录之外运行编译产物均能工作。
5. `npm start` 默认启动 Web；CLI 与构建产物拥有明确入口。
6. 不配置真实模型也能完成类型检查、构建和自动化测试。
7. 运行时只加载 `pi-sdk-run/skills` 内的项目私有 skill，不发现用户级、祖先目录或仓库根级 skill。

## 3. 已确认的现状基线

### 3.1 当前能力

现有 `07a-sse-server.ts` 已实现：

- Express 静态页面和 `POST /chat`。
- 单请求 `fetch()` + response body SSE 流。
- `text`、`thinking`、`tool_start`、`tool_end`、`error`、`done` 事件。
- 单个内存 `AgentSession` 的连续对话与 `busy` 并发保护。
- 工具结果展示截断至 500 个字符。
- 15 秒一次的 `: ping` SSE 心跳。
- 浏览器断开时清理订阅并中断 Agent。

### 3.2 必须迁移的未提交修改

实施前的工作区已有用户修改，必须原样保护：

- `07a-sse-server.ts`
  - 新增 15 秒 SSE 心跳。
  - 不再监听 `req.close`，改用 `req.aborted` 与 `res.close`，避免请求体正常读取后误中断 Agent。
  - 断线时清理心跳与事件订阅，并在未完成时调用 `session.abort()`。
  - Agent 执行异常写入服务端日志。
- 上级 `pi_sdk_learn/code/package.json`
  - 教程脚本统一通过 `tsx --env-file=.env` 加载环境变量。

这些文件是只读迁移源。本项目实施不得回退、覆盖或顺手整理它们；`07a-sse-server.ts` 继续保留为教学原稿。

### 3.3 当前缺口

- `queryDataTool` 跨目录导入 `../shared/lib/tools/query-data.ts`。
- 销售数据以 `process.cwd()/shared/data/sales.csv` 定位。
- 依赖和 scripts 位于上级综合教程项目。
- Agent 初始化、事件翻译、SSE 编码、HTTP 路由和进程启动耦合。
- 没有 CLI、独立配置、构建产物和测试。
- 没有项目私有 skill 的复制、隔离加载、受限正文读取与诊断策略。
- Pi 事件翻译参数为 `any`。
- 工具开始卡片把工具名和参数拼入 `innerHTML`，存在 DOM 注入风险。
- 只处理 `SIGINT`，没有关闭 HTTP Server，也没有处理 `SIGTERM`。
- `message` 只做 truthy 检查，尚未严格验证类型与空白字符串。

### 3.4 `query_data` 兼容基线

迁移后的工具以现有共享实现为行为基线：CSV 首行为表头，其余每行按逗号切分并 trim；支持 `=`、`!=`、`>`、`<`、`>=`、`<=`、`contains`。数值运算要求单元格和值都能转为数字，否则该行不匹配。列名不存在时返回 `isError: true`，文本为 `列名 "<列名>" 不存在。可用列：<以顿号连接的表头>`。成功文本先输出查询条件和 `匹配 <命中数>/<总行数> 行`，再输出逗号空格分隔的表头与数据；`limit` 缺省为 20，超过时追加 `... 还有 <数量> 行未显示`。迁移测试需以当前 13 行 `sales.csv` 建立固定用例，覆盖字符串、数值、无匹配、非法列与截断，不能只验证“能读到文件”。

## 4. 目标架构

```text
Web 入口                 CLI 入口
   │                        │
   ├── HTTP/SSE 渲染        ├── 终端渲染
   │                        │
   └──────────┬─────────────┘
              ▼
       统一 StreamEvent
              ▲
              │ Pi 事件翻译
              │
       DataAgent 核心会话
              │
              ▼
     query_data + data/sales.csv
              │
              └── project-only skills + restricted read
```

依赖方向保持单向：入口层依赖应用层，应用层依赖 Agent SDK 与项目内工具；`events.ts` 和 `sse.ts` 不反向依赖 Express 或 CLI。

## 5. 文件职责与设计约束

| 文件 | 职责 | 关键约束 |
| --- | --- | --- |
| `src/index.ts` | 读取 Web 配置、创建 Agent、启动服务、注册信号处理 | 默认 npm 入口；导入时不应意外启动服务，启动逻辑需可测试 |
| `src/cli.ts` | 解析位置参数、交互循环、终端事件渲染、退出码 | 单次和交互模式共用一个问答执行器与 Agent 实例 |
| `src/agent/index.ts` | 聚合导出 Agent 定义、注册表和 Runner | 对外暴露稳定入口；具体 Agent 仅由注册表管理 |
| `src/events.ts` | 定义判别联合 `StreamEvent` 及必要的 Agent 抽象 | Web/CLI 共用；禁止 `any` 泄漏到调用方 |
| `src/sse.ts` | 唯一定义 Pi 事件到 `StreamEvent` 的映射，并提供 SSE 与心跳编码 | 翻译函数与传输编码均为纯函数；CLI 只复用翻译结果，不经过 SSE 编码 |
| `src/server.ts` | 创建 Express app、`POST /chat`、静态资源、HTTP 生命周期 | 支持依赖注入 fake Agent；跟踪活动响应及其 cleanup；不得在模块顶层监听端口 |
| `src/tools/query-data.ts` | 加载/过滤项目内 CSV，定义 `query_data` | 数据路径与模块位置绑定；保留现有运算符和输出语义 |
| `src/tools/read-skill.ts` | 包装 SDK read 定义，只读取项目 skills | 名称保持 `read` 以支持渐进披露；realpath 后做目录边界检查；只读 |
| `skills/dg-piagent/` | 项目初始化时随附的首个 skill | 从根级源目录完整复制；运行时只使用本地副本；保留 references 相对路径 |
| `public/index.html` | 浏览器页面结构和样式 | 不内联不可信数据，不承担可测试的协议解析逻辑 |
| `public/app.js` | 浏览器交互、SSE 分帧和安全 DOM 渲染 | 导出或隔离可测试纯函数；所有不可信字段用 `textContent` |
| `test/cli.test.ts` | 单次/交互 CLI、退出码和清理测试 | 注入 fake Agent 和输入输出流，不连接模型 |
| `test/client.test.ts` | SSE 分帧和 DOM 安全测试 | 覆盖 chunk/CRLF/坏帧/提前 EOF；确认不使用动态 `innerHTML` |
| `test/query-data.test.ts` | CSV 定位、过滤与输出兼容测试 | 使用项目内固定数据；覆盖跨 cwd、非法列、数值比较和 limit |
| `test/read-skill.test.ts` | skill 正文读取安全测试 | 允许项目 skill；拒绝目录穿越、绝对越界与 symlink 逃逸 |
| `test/skills.test.ts` | ResourceLoader skill 发现和诊断测试 | 只加载项目本地 `dg-piagent`；不受 cwd、用户目录和父目录影响 |
| `test/sse.test.ts` | 流式事件与 wire format 单元测试 | 不连接模型、不监听真实端口 |
| `test/server.test.ts` | HTTP 参数、忙碌、流式、异常、断线测试 | 注入 fake Agent；测试后无定时器和 Server 句柄残留 |

建议 `createDataAgent()` 返回项目自有接口，而不是让 Express/CLI 直接操作 SDK Session：

```ts
interface DataAgent {
  prompt(message: string, onEvent: (event: StreamEvent) => void): Promise<void>;
  abort(): void;
  dispose(): Promise<void>;
  readonly modelName: string;
}
```

`agent.ts` 在一次 `prompt()` 内建立 SDK 订阅，在该 Promise settle 或中止时自行退订；Server 不持有 SDK 的 unsubscribe，只持有本请求的 HTTP listener、heartbeat 和响应 cleanup。即使底层 SDK 的 `dispose()` 是同步的，包装接口也返回已完成的 Promise，使关闭流程能够统一等待。接口的最终形态可根据 SDK 的精确事件类型小幅调整，但必须保留依赖注入能力、单会话连续对话和幂等释放。

## 6. 项目私有 Skill 支持

### 6.1 初始化内容与所有权

初始化阶段将仓库根级 `skills/dg-piagent/` 递归复制到 `pi-agent/pi-sdk-run/skills/dg-piagent/`。复制范围包括 `SKILL.md` 和全部 `references/`；不复制根级 `skills/README.md`，避免它被当作散装 skill 扫描。不得使用软链接，因为独立项目被复制或打包后必须仍然完整。

目标项目内副本是运行时唯一来源，也是此后项目维护的版本。根级 `skills/dg-piagent/` 只是一次性初始化基线：运行时代码、npm scripts、测试和构建产物均不得引用它。源与副本未来可以分叉，升级必须作为显式维护动作并重新运行 skill 契约测试。

当前源目录共有 63 个文件，约 1.2 MiB；首次复制后、任何修复前，先对源/目标递归相对路径清单和文件内容做一次性比较，证明未被链接引用的文件也没有漏掉，并保存源 manifest/hash。随后对项目副本执行 Markdown 本地链接审计。已知源基线至少缺少 `references/skill-maintenance.md` 和根级 `CHANGELOG.md`，并有若干历史相对链接指向不存在的文件；实现阶段需逐项判断为真实依赖、历史错链或示例占位，只在项目副本中补齐/改正/标记，并生成迁移差异记录。常规测试验证“初始 manifest + 已记录差异 = 当前项目副本”，不再直接比较已修复副本与源目录。最终验收要求项目副本的真实导航链接可用，不要求它与源目录继续字节一致，也不得反向修改源目录。

### 6.2 隔离加载策略

`createDataAgent()` 构造 `DefaultResourceLoader` 时使用稳定的项目根目录，并配置：

```ts
new DefaultResourceLoader({
  cwd: projectRoot,
  agentDir,
  noSkills: true,
  additionalSkillPaths: [projectSkillsDir],
  // systemPromptOverride 与 query_data 注册省略
});
```

SDK 0.83.0 中 `noSkills: true` 会关闭默认 skill 扫描，但不会关闭 `additionalSkillPaths`，因此这组配置只引入 `<projectRoot>/skills`。不能依赖 `.pi/skills` 自动发现，因为自动发现还可能合并用户级、祖先 `.agents/skills` 和 package skill，不符合“只在本项目中使用”的隔离要求。

项目启动时在 `await loader.reload()` 后调用 `loader.getSkills()`：

- 精确断言首版只加载一个名为 `dg-piagent` 的 skill，并对 `skill.filePath` 做 realpath；结果必须严格等于 `<projectRoot>/skills/dg-piagent/SKILL.md` 的 canonical path。
- diagnostics 中的 collision、warning 和 error 都写入可注入 logger，且不得把 skill 正文或敏感路径内容写入日志。
- 目标 skill 缺失、canonical 来源不符、名称不匹配、description 为空、目标元数据 warning、collision 或 error diagnostic 时启动失败。
- 与目标 skill 无关的普通 warning 通过可注入 logger 输出但不阻止启动；规则固定并测试，避免机器差异改变行为。

Web、交互式 CLI 和单次 CLI 只能调用同一个 `createDataAgent()`，不得各自创建不同的 ResourceLoader 配置。

### 6.3 Skill 正文读取与工具白名单

Skill 索引只把 `name`、`description`、`location` 放入系统提示词，正文需要模型调用名为 `read` 的工具按需读取。直接启用 SDK 内置 read 会允许读取项目外文件，因此首版创建受限的 `readSkillTool`：

1. 以 `createReadToolDefinition(projectRoot)` 获得 SDK read 的 offset、limit、截断与内容处理能力。
2. 用 `defineTool()` 包装并保持工具名为 `read`，以兼容 skill 索引中的读取指令。
3. 对允许根 `<projectRoot>/skills/dg-piagent` 和输入目标都执行 realpath；输入相对路径按 `projectRoot` 解析。Skill 索引会给模型绝对 location，并要求正文中的相对引用先按 SKILL.md 所在目录解析为绝对路径后再调用 read。
4. 仅允许 canonical 目标位于 canonical `dg-piagent` 根下且是普通文件；这同时阻止 `..`、相似前缀、目录读取和指向目录外的符号链接。
5. 把已经校验过的 canonical 路径传给底层 read 执行，不再使用原始路径，避免检查与读取对象不一致。
6. 不存在文件返回普通工具错误，不通过错误信息泄露允许目录外的文件状态。
7. Agent 激活工具精确为 `query_data` 和受限 `read`；不启用 SDK 的 unrestricted read、bash、write、edit、grep、find 或 ls。

威胁模型假设项目安装目录及 skill 文件由本机可信维护者管理，不处理另一个本地进程在检查后并发替换文件的对抗性 TOCTOU；Web 用户输入仍被视为不可信。

实现阶段必须用 SDK 0.83.0 的实际 tool registry 验证自定义 `read` 是否正确替换/优先于内置同名定义；若同名注册产生 diagnostic 或优先级不确定，则通过 customTools 注册方式、扩展注册顺序和 `tools` 白名单实现唯一活动的受限 read，并以测试证明，不能退回开放内置 read。

### 6.4 系统提示词边界

现有 DataAgent 人设继续要求销售结论基于 `query_data`。skill 索引作为补充能力注入，但不得改变销售问答的真实性要求。`dg-piagent` 只会在用户问题与其 description 匹配时被模型按需读取；普通销售查询不应为了加载 skill 而调用 read。

首版不增加 Web/CLI 的 skill 管理接口，不允许用户在运行时添加路径，也不暴露全局 skill 列表。SDK 0.83.0 的 `session.prompt("/skill:dg-piagent ...")` 会展开 skill 正文，因此 Web、交互式 CLI 和单次 CLI 共同支持该语法，全部原样交给同一个 Session，不在入口层重复解析。未知 `/skill:*` 的错误行为同样由 SDK 统一产生并测试。

## 7. 统一事件契约

`StreamEvent` 使用判别联合，目标形态如下：

```ts
type StreamEvent =
  | { type: "text"; data: { delta: string } }
  | { type: "thinking"; data: { delta: string } }
  | { type: "tool_start"; data: { id: string; name: string; args: JsonValue } }
  | { type: "tool_end"; data: { id: string; name: string; result: string; isError: boolean } }
  | { type: "error"; data: { message: string } }
  | { type: "done"; data: Record<string, never> };
```

兼容原则：

- SSE 仍不使用 `event:` 字段；事件类型保留在 JSON 的 `type` 字段。
- 编码保持 `data: ${JSON.stringify(event)}\n\n`。
- 心跳继续使用 SSE 注释，不进入 `StreamEvent`。
- `done` 由一次 prompt 的生命周期统一产生，而不是依赖某个 Pi 内部事件。
- `error` 后仍发送 `done`，前提是响应连接仍可写。
- 每轮由项目层最多产生一个 `error`；若 SDK 事件已经翻译成 `error`，后续同一故障的 Promise rejection 只记录日志，不重复发帧。
- 对 SDK 不关心的事件返回 `null`。
- 优先导入 SDK 已导出的事件类型；若 SDK 未导出稳定公共类型，则定义最窄的本地输入联合并使用类型守卫，不使用 `any`。
- 工具参数先规范化为递归 `JsonValue`。循环引用、`bigint` 或不可序列化成员转换为可读占位字符串，单个坏参数不得终止整个 SSE 流。

CLI 消费同一 `StreamEvent`。是否显示 `thinking` 可保持默认显示，也可在实现时增加非破坏性的开关；首版不得因此改变 Web wire format。

## 8. 配置与路径策略

### 8.1 环境变量

- `PORT=3000`：解析为 1–65535 的整数，无效值启动失败并给出明确错误。
- `HOST=127.0.0.1`：传入 HTTP Server 监听。
- `PI_CODING_AGENT_DIR=.pi-config`：继续交给 Pi Agent SDK 使用；相对值必须相对项目目录解析，不能相对调用者 cwd 漂移。

开发 scripts 延续现有未提交修改所表达的 `.env` 加载需求。具体采用 Node `--env-file`、`tsx --env-file` 或轻量依赖，应以 Node 版本和生产入口一致性为准，且 `.env` 不提交。

### 8.2 项目根目录

在 ESM 中从 `import.meta.url` 推导模块目录和项目根目录。禁止以下模式：

```ts
join(process.cwd(), "shared/data/sales.csv")
```

需要同时验证源码执行与编译后执行的目录层级。数据与 skills 可由构建脚本复制到 `dist/`，或让构建产物稳定引用项目根资源；采用哪一种都必须在 `npm pack --dry-run` 和跨 cwd 冒烟测试中证明 `data/`、`skills/**/SKILL.md` 和全部 skill references 完整。

## 9. HTTP 与并发行为

`POST /chat` 的处理顺序：

1. 在写 SSE headers 前验证请求体：`message` 必须是字符串，trim 后非空。
2. 若共享 Agent 正忙，返回 `429` JSON。
3. 占用 busy 状态并写 SSE headers。
4. 建立事件转发与 15 秒心跳。
5. 监听 `req.aborted` 和 `res.close`。记录 disconnected；只有 prompt 尚未 settled 时才 abort。
6. 执行 prompt，将翻译后的事件写入响应。
7. 异常时记录服务端错误并尽力发送 `error`。
8. `finally` 中幂等清理监听、订阅和心跳，尽力发送一次 `done`，结束响应并释放 busy。

每个请求共享 `aborted`、`doneSent`、`cleaned` 三个幂等状态：任何路径最多调用一次 Agent abort、最多写一个 `done`、最多执行一次资源 cleanup。建立断线监听后、调用 prompt 前必须再次检查 disconnected；一旦断线，不得启动 prompt。不得重新引入 `req.close` 作为正常请求后的断线依据。对于已关闭或 destroyed 的响应，写入应静默跳过；客户端断线不应被记录成模型故障。

首版维持单 Agent、单用户、拒绝并发的语义，不在本次重构中扩展多用户 Session。README 中必须明确这不是面向多租户的会话隔离方案。

## 10. CLI 设计

### 10.1 模式判定

- `npm run cli`：没有非选项位置参数，进入交互模式。
- `npm run cli -- "问题"`：将位置参数连接为一个问题，运行一次后退出。
- 空白单次问题视为使用错误，写 stderr 并以非零状态退出。

### 10.2 交互模式

- 使用 Node `readline/promises`，避免新增仅为提示符服务的依赖。
- 每轮问题复用同一个 Agent，从而保留连续对话。
- EOF 正常退出；`Ctrl+C` 走统一 shutdown。
- 可支持 `exit`/`quit` 作为便利命令，但需在 README 中记录并测试。
- prompt 进行中不接受第二个问题。

### 10.3 渲染

- `text`：增量写 stdout。
- `thinking`：用明确前缀或 stderr 展示，避免与最终答案难以区分。
- `tool_start`/`tool_end`：单行摘要，参数和结果进行安全的字符串化与长度控制。
- `error`：写 stderr；单次模式设置非零退出码。
- `done`：补齐换行并恢复交互提示。

## 11. 前端安全与健壮性

必须移除工具卡片的动态 `innerHTML`。工具卡片通过 `document.createElement()` 创建固定结构，工具名、参数、结果和错误均赋给 `textContent`。固定的装饰节点（例如 loading dots）也使用 DOM API 或静态模板创建，避免未来误把不可信字段插入 HTML。

同时处理：

- `fetch()` 成功但 `res.body` 为空。
- 非 JSON 错误响应。
- SSE 数据跨 chunk、同一 chunk 多帧、心跳注释和 CRLF。
- 单帧 JSON 解析失败：展示可读错误并恢复 UI。
- 流在未收到 `done` 时结束：恢复 busy 状态并提示连接提前结束。
- AbortError 视为用户主动停止，不显示红色故障。

将 SSE 分帧和 DOM 渲染移到无打包步骤的 `public/app.js`，以便用可注入输入测试纯解析逻辑；浏览器仍直接加载原生脚本，本次不引入前端打包器。

## 12. 优雅退出设计

`SIGINT`、`SIGTERM` 和测试调用共享一个幂等异步 `shutdown(reason)`；首次调用缓存并返回同一个关闭 Promise，后续调用只等待它：

1. 原子地标记 closing；在监听器完全关闭前到达的请求返回 `503`。
2. 立即调用 `server.close()` 停止接收新连接，同时启动关闭超时（首版固定 5 秒并写入测试）。
3. 若有活动 prompt，通过请求级幂等函数调用 Agent `abort()`；随后对仍可写的响应发送一次 `done`，再同步调用所有活动 HTTP/SSE cleanup，清除 heartbeat/listener 并结束响应，避免 SSE 阻塞 `server.close()`。由 `aborted`、`doneSent`、`cleaned` 保证随后触发的 `res.close` 和 prompt `finally` 不重复操作。
4. 等待 `server.close()` 完成；5 秒超时后调用当前最低 Node 版本支持的 `server.closeAllConnections()`，并再次等待 close 回调。
5. `await agent.dispose()`，仅执行一次。
6. 移除进程信号监听；信号关闭将 `process.exitCode` 设为 0，启动/运行故障保留非零状态。

信号回调中避免立即 `process.exit()`，让 Node 在资源关闭后自然退出。Server factory 必须暴露 `shutdown()` 供测试直接等待；信号注册放在入口层，导入模块时不产生副作用。

## 13. 测试计划

### 13.1 `test/sse.test.ts`

- 各 `StreamEvent` 的 SSE 编码精确匹配并以双换行结束。
- 文本 delta、thinking delta 翻译正确。
- 工具开始字段完整，参数规范化为 `JsonValue`。
- 工具结束提取文本、默认 `isError=false`、结果截断 500 字符。
- 不关心的 Pi 事件返回 `null`。
- 特殊字符和换行经 JSON 编码后可往返解析。
- 循环对象、`bigint` 等工具参数被安全规范化，编码不会抛错。
- 心跳精确为 `: ping\n\n`。

### 13.2 `test/server.test.ts`

- 缺少 message、非字符串、空字符串和纯空白返回 `400` JSON。
- malformed JSON 与非 JSON 请求返回一致的 JSON 错误，不包含堆栈。
- 有效请求返回正确 SSE headers。
- SSE headers 精确包含 `Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive` 和 `X-Accel-Buffering: no`。
- fake Agent 事件按顺序写出，结束时恰好一个 `done`。
- Agent 异常写出 `error` 后写出 `done`，busy 被释放。
- 注入 logger 后，Agent 异常恰好记录一次；客户端主动中止不记录为 Agent 故障。
- 第一请求未完成时第二请求返回 `429`。
- 客户端中止触发一次 abort，并清理订阅/心跳。
- 正常请求体读取完成不会误 abort。
- app/server 可在临时端口启动和关闭，测试结束无悬挂句柄。
- 静态首页可访问。
- `shutdown()` 立即清理活动 SSE、abort prompt、等待 Server 和异步 dispose；重复调用只执行一次。
- shutdown 对每个活动请求最多 abort 一次、发送一个 `done`、执行一次 cleanup；`res.close` 与 prompt `finally` 不重复动作。
- `SIGINT`、`SIGTERM` 入口测试走同一关闭函数并设置正确退出状态。

为缩短测试时间，心跳间隔通过 server factory 选项注入，而不是等待真实 15 秒。

### 13.3 `test/query-data.test.ts`

- 从项目目录和临时 cwd 都读取同一份项目内 `sales.csv`。
- `=`、`!=`、`>`、`<`、`>=`、`<=`、`contains` 各有固定断言，非数值参与数值比较时不匹配。
- 非法列返回 `isError: true`，并精确匹配当前错误文本和可用列顺序。
- 成功结果精确匹配查询条件、命中/总数、表头与数据行格式。
- 默认 limit 为 20；自定义 limit 截断并输出准确的剩余行数。
- 使用当前 13 行 fixture 验证数据未在迁移时缺失或悄然变化。

### 13.4 `test/skills.test.ts`

- `noSkills: true` 下只通过项目绝对 `additionalSkillPaths` 加载 `dg-piagent`。
- 在临时 HOME/agentDir 和父目录放置同名或额外 skill，确认它们不会进入最终列表。
- 注入一个 package skill fixture，确认 `noSkills: true` 后不会混入最终列表。
- 从项目目录与临时 cwd 创建 Agent，最终 skill 名称和 filePath 都指向目标项目副本。
- 对最终 filePath 做 realpath 并精确匹配项目副本，拒绝同名外部路径或 symlink 来源。
- `SKILL.md` frontmatter 合法，name 为 `dg-piagent`，description 非空且不超过 SDK 限制。
- 验证已保存的初始源 manifest/hash、迁移差异记录与当前项目副本一致；修复后审计真实本地导航链接，并对有意的示例占位建立明确 allowlist。源/目标字节比较只在修复前执行一次，不属于常规测试。
- 缺失 skill、空 description、collision 和 error diagnostic 触发明确启动失败。
- `formatSkillsForPrompt()` 只包含项目副本位置，不出现仓库根级或用户级路径。
- 普通销售问题不会调用 read；匹配 `dg-piagent` description 的 fake/可控模型场景会读取 skill 正文。
- 端到端验证 prompt 索引中的绝对 location → 读取 `SKILL.md` → 将其中一个原始相对 reference 按 skill baseDir 解析为绝对路径 → 成功读取目标文件。
- Web、交互式 CLI、单次 CLI 的 `/skill:dg-piagent` 均由 Session 成功展开；未知 skill 行为一致。

### 13.5 `test/read-skill.test.ts`

- 可以读取 `skills/dg-piagent/SKILL.md` 及其 references，并保留 offset/limit 行为；底层 execute 接收的是已验证 canonical 路径。
- 拒绝 `../` 目录穿越、目录外绝对路径、相似前缀目录和指向目录外的 symlink。
- 拒绝读取 `.env`、`src/`、`data/` 和 `.pi-config`。
- 不存在路径与越界路径返回受控错误，不泄露目标内容。
- Agent 活动工具列表中只有 `query_data` 和受限 `read`，没有 unrestricted read 或其他编码工具。

### 13.6 `test/cli.test.ts`

- 无位置参数进入交互模式，多轮输入复用同一 fake Agent。
- 多个位置参数按空格合并为一次问题。
- 空白问题、Agent 失败和正常成功的退出码符合约定。
- EOF、`Ctrl+C` 和异常路径都只 dispose 一次。
- 文本、思考、工具、错误和 done 的终端输出不互相粘连。

### 13.7 `test/client.test.ts`

- SSE 帧跨 chunk、单 chunk 多帧、LF/CRLF 和心跳注释都可解析。
- 坏 JSON、空 response body 和未收到 done 的提前 EOF 能恢复 UI 并给出可读提示。
- AbortError 不渲染故障。
- 含 HTML 的工具名、参数、结果和错误只成为文本节点；静态检查和 DOM 测试确认不存在动态 `innerHTML`。

### 13.8 独立性进程测试

- 在临时 cwd 通过绝对路径运行原项目中的 `dist/index.js`，验证静态文件、CSV 和唯一的项目 skill 可定位。
- 生成实际部署目录或 npm tarball，解压到仓库之外的临时目录；在根级 skill 不可见时启动 Web、交互式 CLI 和单次 CLI，读取静态资源、CSV、`SKILL.md` 与至少一个 reference。
- 在仓库根目录运行 `npm --prefix pi-agent/pi-sdk-run` 的 typecheck/test/build 命令。
- 对无模型的 Web/CLI 进程测试注入 fake Agent 或测试入口，禁止读取真实凭据。
- 对 `start`、`dev`、`start:prod`、交互 CLI 和单次 CLI 建立“项目 cwd / 仓库根 npm --prefix / 无关 cwd 部署产物”矩阵；开发命令不适用部署产物的格子明确标为 N/A，而不是跳过。

### 13.9 非自动化冒烟

真实模型只用于最终人工验证：

1. Web 连续问两轮，确认上下文延续。
2. Web 点击停止，确认连接和 Agent 都中断，随后可以再次提问。
3. 交互 CLI 连续问两轮。
4. 单次 CLI 返回答案并自然退出。
5. `SIGINT`、`SIGTERM` 下服务端不遗留监听端口。
6. 缺少可用模型时启动失败信息明确且不泄漏密钥。
7. 询问与 `dg-piagent` description 匹配的问题，确认受限 read 读取项目副本；普通销售问题不触发 skill 读取。

## 14. 分阶段实施顺序

### 阶段 0：保护基线

- 再次记录 `git status` 和两个已修改文件的 diff。
- 不编辑教学原稿和上级 `package.json`。
- 确认目标目录只包含本项目文件，不复制 `.env`、`.pi-config` 或 `node_modules`。

验收：用户现有 diff 未变化；敏感/本地文件未进入目标目录。

### 阶段 1：独立工程骨架与项目 skill

- 创建独立 `package.json`、锁文件、`tsconfig.json`、`.gitignore`、`.env.example`。
- 将根级 `skills/dg-piagent/` 完整复制到项目 `skills/dg-piagent/`，不使用软链接。
- 在任何修复前执行一次源/目标清单与内容比较并保存 manifest/hash；随后审计并在项目副本修复已知断链，保存迁移差异记录。
- 固定与当前教程兼容的 Pi SDK、Express、TypeBox、TypeScript、tsx 和测试依赖。
- 定义 `start`、`dev`、`cli`、`build`、`start:prod`、`test`、`typecheck` scripts。

验收：在目标目录内独立 `npm install`；scripts 不引用父目录；删除/隔离根级源目录后项目副本仍完整；真实导航链接通过审计。

### 阶段 2：数据与工具内聚

- 复制 `sales.csv` 到项目 `data/`。
- 迁移 `query_data`，使用稳定模块相对路径。
- 保持列校验、运算符、默认 limit、错误语义和输出格式。

验收：从不同 cwd 执行工具测试均能读取数据；源码无 `../shared`。

### 阶段 3：Agent 与事件核心

- 实现 `events.ts`、`sse.ts` 和 `agent.ts`。
- 从 SDK 公共类型或最窄本地联合消除 `any`。
- 建立单一 prompt/subscribe/abort/dispose 生命周期。
- 配置隔离的 ResourceLoader，只加载项目 skills；加入受限 read 工具并检查 diagnostics。

验收：SSE、skills 和 read-skill 单元测试通过；fake Agent 可被 Web/CLI 使用；活动工具仅为 `query_data` 与受限 `read`。

### 阶段 4：Web 服务

- 实现 app/server factory、参数验证、busy 状态、SSE 心跳和断线处理。
- 迁移静态页面并消除动态 `innerHTML`。
- 增强 malformed request、空响应体和异常流处理。

验收：HTTP 自动化测试通过；协议与旧页面兼容。

### 阶段 5：CLI

- 实现单次与交互模式及可注入 I/O 的 CLI runner。
- 复用 DataAgent 和 `StreamEvent`，实现信号/EOF/异常清理。

验收：CLI 自动化测试和进程级冒烟通过，两种模式不复制事件翻译。

### 阶段 6：构建与生命周期

- 产出 `dist/`，保证静态页面与 CSV 可用。
- 实现 `SIGINT`、`SIGTERM`、HTTP Server 和 Agent 的幂等关闭。
- 检查 npm 包/部署产物包含静态页面、数据和全部 skill 文件/references。

验收：`npm run build && npm run start:prod` 可用；信号测试无悬挂进程。

### 阶段 7：独立性与最终验收

- 运行类型检查、测试、构建。
- 从项目目录、仓库根目录和其他 cwd 验证 dev/prod 启动。
- 搜索运行时代码中的父目录引用和 cwd 依赖。
- 使用真实 SDK 配置完成 Web/CLI 和 skill 按需读取冒烟。
- 根据实际实现更新 README，不保留“计划中”描述。

验收：第 15 节清单全部通过。

## 15. 最终验收清单

### 工程独立性

- [ ] `npm install` 只读取 `pi-sdk-run/package.json` 和锁文件。
- [ ] 源码、scripts、测试均不引用 `pi_sdk_learn`、`shared/` 或根级 `package.json`。
- [ ] 运行时不引用根级 `skills/`；项目内包含完整 `skills/dg-piagent/` 副本及 references。
- [ ] 初始化复制有一次性源/目标清单与内容证明，后续项目副本修复有差异记录。
- [ ] 不依赖 `process.cwd()` 查找项目资源。
- [ ] `.env`、密钥、`.pi-config`、`node_modules` 不被提交。

### 命令

- [ ] `npm start` 默认启动 Web。
- [ ] `npm run dev` 启动开发 Web。
- [ ] `npm run cli` 启动交互 CLI。
- [ ] `npm run cli -- "对比华东和华南的总销售额"` 完成单次问答。
- [ ] `npm run build` 生成可运行产物。
- [ ] `npm run start:prod` 从构建产物启动。

### 行为与安全

- [ ] Web/CLI 共用 Agent 和 `StreamEvent`。
- [ ] 单 Session 连续对话有效，并发请求得到 `429`。
- [ ] 旧 SSE 业务事件和 15 秒心跳保持兼容。
- [ ] 浏览器停止时 Agent 被中断，正常请求体结束不会误中断。
- [ ] 页面无不可信数据的 `innerHTML` 注入点。
- [ ] `SIGINT`、`SIGTERM` 完整关闭 Server、Session、定时器和订阅。
- [ ] 自动化测试不要求真实模型或密钥。
- [ ] Web/CLI 只加载项目内 `dg-piagent`，不混入用户级、父级或 package skills。
- [ ] 加载项 canonical filePath 精确指向项目副本；目标诊断失败关闭，普通无关 warning 仅记录。
- [ ] Skill 正文可由受限 `read` 按需读取，且无法读取 skills 目录外文件或经 symlink 越界。
- [ ] 活动工具仅包含 `query_data` 和受限 `read`，未开放 bash/write/edit。
- [ ] Web、交互式 CLI 和单次 CLI 的 `/skill:dg-piagent` 展开行为一致。

### 质量门禁

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Web、交互 CLI、单次 CLI 人工冒烟
- [ ] 跨 cwd 的开发与生产启动验证
- [ ] 构建/打包产物中的 skill 相对引用完整性验证
- [ ] 部署产物解压到仓库外后完成 Web、两种 CLI、CSV、skill 与 reference 验证
- [ ] 原教学文件及用户未提交修改保持不变

## 16. 风险与决策记录

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| SDK 事件类型未稳定导出 | 事件翻译难以完全复用上游类型 | 使用最窄输入联合和类型守卫，集中在 `sse.ts` 隔离 |
| 编译后 `import.meta.url` 层级变化 | CSV 或静态页面找不到 | 明确项目根策略，并做 dev/prod/跨 cwd 三类测试 |
| 单 Session 同时被 Web 和 CLI 使用 | 并发 prompt 破坏会话 | 每个进程只运行一种入口；入口内维持 busy/串行约束 |
| 客户端断线与正常完成竞态 | 重复 abort、done 或清理 | settled 标志与幂等 cleanup；对 writable 状态做判断 |
| `server.close()` 被长连接拖住 | 进程无法退出 | 先 abort prompt，再有限等待并关闭剩余连接 |
| README 先于实现 | 命令可能误导 | 当前显著标注“仅文档”；完成后以实际命令和版本回写 |
| 复制数据后来源分叉 | 教程和独立项目数据不一致 | 将独立副本视为项目资产；变更时显式同步并测试 |
| 默认 skill 自动发现混入全局内容 | 不同机器行为不一致，违反项目私有边界 | `noSkills: true` + 唯一绝对 `additionalSkillPaths`，断言最终列表 |
| Skill 正文需要 read | 不启用则 skill 形同虚设；启用内置 read 又可能泄密 | 注册名称为 `read` 的目录受限包装器，realpath 防 symlink 逃逸 |
| Skill references 构建时遗漏 | 开发可用、生产失效 | 递归复制整个 skill 目录，链接完整性与打包清单自动测试 |
| 源 skill 已有断链 | 复制后按需读取某些章节失败 | 先做完整镜像证明，再只修项目副本并记录迁移差异 |
| `dg-piagent` 与销售人设不匹配 | 普通问答无谓读取 skill 或提示冲突 | 依赖 description 按需触发，并测试普通销售问题不调用 read |

## 17. 非目标

本次重构不包含：

- 修改或删除 `07a-sse-server.ts` 教学原稿。
- 多用户、多租户或持久化 Session。
- 身份认证、授权、限流和公网生产安全加固。
- 前端框架、构建器或 UI 大改版。
- 模型 Provider 管理界面或凭据迁移。
- 用户级/global skill 安装、在线 skill 市场、运行时上传或热加载 skill。
- 自动同步根级 `skills/dg-piagent` 的后续变更；项目副本独立维护。
- 对 CSV 查询工具进行 SQL 化、聚合引擎化或更换数据集。
- Docker、云部署清单或反向代理配置；README 只记录通用部署注意事项。

## 18. 实施交接说明

进入编码阶段前，实施者应先阅读本计划、README、当前工作区 diff、四个代码/数据迁移源，以及根级 `skills/dg-piagent/SKILL.md` 与其 references。若实际 SDK API 与本文接口草案不一致，应保持目标行为和测试边界，记录必要调整，而不是把 SDK 类型泄漏回 Web/CLI。

编码完成后必须把 README 的状态改为“已实现”，补充实际 Node 版本、依赖版本、准确的 `.env` 加载方式、CLI 退出命令、测试命令与部署产物布局。
