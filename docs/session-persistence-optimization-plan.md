# Session 持久化优化计划

## 1. 目标

将 Agent 会话从当前的纯内存模式升级为项目目录内的文件持久化模式，优先使用项目根目录下的 `.pi/`，实现：

- 服务重启后可恢复既有对话上下文；
- 不同 Agent 的会话文件相互隔离；
- Web 与 CLI 的会话行为明确、可配置；
- session 文件不进入 Git，不泄露认证信息；
- 为后续用户级/租户级会话隔离留下扩展点。

## 2. 当前实现与问题

当前 `src/agent/runner.ts` 使用 `SessionManager.inMemory()` 创建 SDK 会话。上下文只存在于 Node.js 进程内，进程重启后丢失。

`AgentManager` 使用 `Map<agentId, Promise<AgentRunner>>` 在单个进程内缓存 Runner，因此当前具备 Agent 级隔离，但没有用户级隔离：同一个 Agent 的不同 Web 客户端会共享同一份上下文。项目当前也没有传递或校验 `sessionId`。

模型和认证配置仍位于 `PI_CODING_AGENT_DIR` 指向的目录（默认 `.pi-config/`），不应与 session 文件混放。

## 3. 目标目录布局

推荐将持久化数据放在项目根目录：

```text
.pi/
└── sessions/
    ├── reach/
    │   └── <session-id>.jsonl
    ├── sales/
    │   └── <session-id>.jsonl
    └── minimal/
        └── <session-id>.jsonl
```

说明：Pi SDK 的 `SessionManager.create(cwd, sessionDir)` 会创建持久化 session；SDK 示例同时支持 `continueRecent(cwd, sessionDir)` 和 `open(path, ...)`。最终文件格式、命名和元数据以锁定的 SDK 版本 `0.83.0` 为准，不自行复制 SDK 的 session 格式。

`.pi/` 与 `.pi-config/` 的职责分离如下：

| 目录 | 内容 |
| --- | --- |
| `.pi/sessions/` | 对话事件、消息和会话树等 session 持久化数据 |
| `.pi-config/` | `auth.json`、`models.json` 等模型与认证配置 |

## 4. 推荐方案

### 4.1 抽象运行时路径

在 `src/paths.ts` 增加：

- `piDirectory = resolve(projectRoot, ".pi")`；
- `sessionDirectory = resolve(piDirectory, "sessions")`；
- 按 Agent ID 生成安全的 Agent session 子目录；
- 必要时允许 `PI_SESSION_DIR` 覆盖默认目录，但覆盖目录必须是明确路径，不能改变 `.pi-config/` 的含义。

启动时确保目录存在，并对 Agent ID 做路径安全校验，禁止 `../`、路径分隔符和空 ID 造成目录穿越。

### 4.2 Runner 使用文件型 SessionManager

将 `createAgentRunner()` 中的：

```ts
SessionManager.inMemory()
```

替换为按 Agent 选择的文件型 SessionManager。首期建议每个 Agent 使用自己的 session 目录，并在进程启动后恢复该 Agent 最近一次会话：

```ts
SessionManager.continueRecent(projectRoot, agentSessionDirectory)
```

如果目录中没有历史 session，则创建新会话。创建完成后记录 `session.sessionFile`，用于日志、诊断和测试。

### 4.3 明确恢复策略

默认策略建议为“每个 Agent 恢复最近会话”，并增加配置项：

- `PI_SESSION_MODE=memory`：保留临时运行模式；
- `PI_SESSION_MODE=continue-recent`：默认，恢复 Agent 最近会话；
- 后续可增加 `new`、`open` 或 API 指定 session。

恢复失败不能静默吞掉：应记录原因，并根据配置选择直接失败或降级创建新会话，避免用户误以为历史记忆已恢复。

### 4.4 Web/CLI 会话隔离边界

持久化本身不能自动解决用户隔离问题。建议分两阶段实现：

1. **默认兼容方案**：未提供 sessionId 时使用 `default`，按 Agent ID 恢复最近会话。
2. **显式隔离方案**：`/chat` 支持 `sessionId`，使用 `.pi/sessions/<agentId>/<sessionId>/` 存储，并在 `AgentManager` 中以 `agentId + sessionId` 作为缓存键。CLI 使用 `--session` 选择会话。

没有可靠身份来源时，不应根据 IP、User-Agent 或浏览器随机值宣称实现了安全隔离。

## 5. 生命周期与并发

- `AgentManager` 继续复用已打开的 Runner，避免同一 session 被重复打开；
- 同一缓存键继续禁止并发 prompt；
- `dispose()` 前等待活动请求结束，并确保 SDK 将待写入事件刷入文件；
- 进程收到 `SIGINT`、服务 shutdown 或启动失败时执行统一释放；
- 写入异常、权限异常和 session 损坏需要有可读错误；
- 不在正常日志中输出消息正文、API Key 或完整 session 内容。

## 6. 安全与运维要求

- `.pi/` 加入 `.gitignore`，并在 README 中警告其中包含敏感对话内容；
- 文件权限按运行用户最小权限创建；
- 对 session 文件做原子写入/SDK 原生写入，不自行使用不完整的 JSON 覆盖；
- 提供清理命令或文档化手动清理方式，但默认不自动删除历史记忆；
- 未来可增加保留周期、最大 session 数、磁盘空间检查和导出/删除能力；
- session 目录与 `.pi-config/` 分开备份，认证文件不得随 session 一起导出。

## 7. 实施阶段

### Phase 1：路径与配置

- 新增 `.pi/`、session 根目录和 Agent 子目录解析；
- 增加 `PI_SESSION_MODE`、可选 `PI_SESSION_DIR`；
- 更新 `.gitignore`、`.env.example` 和 README；
- 补充路径安全、默认值和错误配置测试。

### Phase 2：SDK 持久化接入

- 将 Runner 的 `SessionManager.inMemory()` 替换为文件型 manager；
- 实现“恢复最近会话，无历史则新建”；
- 记录实际 session 文件路径；
- 验证 dispose、异常和重启恢复行为。

### Phase 3：AgentManager 与接口适配

- 将 Runner 缓存键从 `agentId` 扩展为 `agentId + sessionId`；
- 保持未传 sessionId 的旧请求兼容；
- 为 Web API 和 CLI 增加会话选择能力；
- 防止不同会话共享同一个 SDK Runner。

### Phase 4：测试与文档

- 单元测试：目录解析、Agent 隔离、恢复最近会话、首次创建、损坏文件和权限错误；
- 集成测试：启动 → 对话 → 进程退出 → 重启 → 上下文恢复；
- 并发测试：同一会话互斥，不同会话可独立工作；
- 更新 README 的存储位置、隔离边界、清理和备份说明；
- 执行 `npm run check`。

## 8. 验收标准

- 默认 session 文件实际出现在 `.pi/sessions/` 下；
- `.pi-config/auth.json` 和 `models.json` 仍按原配置路径工作；
- 重启后默认 Agent 能恢复最近一次会话；
- `reach`、`sales`、`minimal` 的 session 不互相读取；
- 关闭服务后文件可读且无明显截断；
- 未提供用户身份时，文档明确说明仍是共享默认会话；
- `.pi/` 不会被 Git 跟踪，测试不泄露认证信息；
- 内存模式仍可通过配置启用，便于临时任务和 CI。

## 9. 待确认决策

1. 默认是否启用“恢复最近会话”，还是仅持久化但每次启动新建 session？
2. Web 首期是否接受同一 Agent 的客户端共享默认会话？
3. 是否需要首期就支持显式 `sessionId`，还是先完成单 Agent 默认会话持久化？
4. `.pi/` 是否需要纳入项目备份，及 session 保留多久？

## 10. 实施决策

- 默认使用 `continue-recent`，按 Agent + session 恢复最近会话；
- Web API 未传 `sessionId` 时保持 `default` 兼容，浏览器 UI 使用保存在 localStorage 的随机 ID；
- 首期已支持 Web 和 CLI 显式 `sessionId`，但它不是身份认证或多租户安全边界；
- 会话默认无保留期，由运维人员在停服后按明确的 Agent/session 子目录清理；
- 恢复异常默认失败；只有设置 `PI_SESSION_RECOVERY=new` 才允许警告后新建会话。
