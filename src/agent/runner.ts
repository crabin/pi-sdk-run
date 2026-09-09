import { chmod, mkdir, readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, type AgentSession, type ResourceDiagnostic, type Skill } from "@earendil-works/pi-coding-agent";
import type { AgentRunner, EventHandler } from "../events.js";
import { defaultSessionId, projectRoot, projectSkillsDirectory, resolveAgentSessionDirectory } from "../paths.js";
import { translateEvent } from "../sse.js";
import { readRuntimeConfig, selectModel, type RuntimeConfig, type SessionRecovery } from "../config.js";
import type { AgentDefinition, ResourceMode } from "./definition.js";

export interface Logger { info(message: string): void; warn(message: string): void; error(message: string, error?: unknown): void }
export const consoleLogger: Logger = console;
export class RunnerError extends Error { constructor(readonly code: "busy" | "disposed", message: string) { super(message); } }
export type CreateAgentRunnerOptions = Partial<RuntimeConfig> & { sessionId?: string };
const diagnosticSummary = (d: ResourceDiagnostic) => `[skill:${d.type}] ${d.message}`;
export async function validateProjectSkills(skills: Skill[], diagnostics: ResourceDiagnostic[], expectedNamesOrFile: string[] | string, logger: Logger = consoleLogger): Promise<void> {
  for (const d of diagnostics) (d.type === "error" ? logger.error : logger.warn).call(logger, diagnosticSummary(d));
  const expectedNames = typeof expectedNamesOrFile === "string" ? ["dg-piagent"] : expectedNamesOrFile;
  if (diagnostics.some((d) => d.type === "error" || d.type === "collision" || (d.type === "warning" && d.path !== undefined && expectedNames.some((name) => d.path!.includes(name))))) throw new Error("项目 skill 诊断失败。");
  for (const name of expectedNames) {
    const skill = skills.find((item) => item.name === name);
    if (!skill?.description.trim()) throw new Error(`项目 skill 校验失败：必须加载具有 description 的 ${name}。`);
    if (await realpath(skill.filePath) !== await realpath(`${projectSkillsDirectory}/${name}/SKILL.md`)) throw new Error(`项目 skill 校验失败：${name} 来源不在项目副本。`);
  }
}
export async function createProjectResourceLoader(definition: AgentDefinition, mode: ResourceMode = definition.resourceMode ?? "project-only", agentDir: string = readRuntimeConfig().agentDir, logger: Logger = consoleLogger) {
  const required = new Set(definition.requiredSkillNames ?? []);
  const loader = new DefaultResourceLoader({ cwd: projectRoot, agentDir, additionalSkillPaths: [projectSkillsDirectory], systemPromptOverride: () => definition.systemPrompt,
    ...(mode === "project-only" ? { noSkills: true, noExtensions: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      skillsOverride: (current) => ({ skills: current.skills.filter((s) => required.has(s.name)), diagnostics: current.diagnostics.filter((d) => !d.path || d.path.startsWith(projectSkillsDirectory)) }) } : {}) });
  await loader.reload(); const { skills, diagnostics } = loader.getSkills();
  await validateProjectSkills(skills, diagnostics, [...required], logger); return loader;
}
export class SdkAgentRunner implements AgentRunner {
  private disposed = false;
  constructor(private readonly session: AgentSession, readonly metadata: NonNullable<AgentRunner["metadata"]>) {}
  get modelName() { return this.metadata.model; }
  get isBusy() { return this.session.isStreaming; }
  async prompt(message: string, emit: EventHandler, signal?: AbortSignal): Promise<void> {
    if (this.disposed) throw new RunnerError("disposed", "Agent 已释放");
    if (this.session.isStreaming) throw new RunnerError("busy", "Agent 正忙，稍等");
    if (signal?.aborted) throw signal.reason ?? new Error("请求已取消");
    const unsubscribe = this.session.subscribe((event) => { const translated = translateEvent(event); if (translated) emit(translated); });
    const onAbort = () => { void this.abort(); }; signal?.addEventListener("abort", onAbort, { once: true });
    try { await this.session.prompt(message); } finally { signal?.removeEventListener("abort", onAbort); unsubscribe(); }
  }
  async abort() { if (!this.disposed && this.session.isStreaming) await this.session.abort(); }
  async dispose() { if (this.disposed) return; await this.abort(); this.disposed = true; this.session.dispose(); }
}
export async function createPersistentSessionManager(directory: string, recovery: SessionRecovery, logger: Logger = consoleLogger): Promise<SessionManager> {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
    if (files.length === 0) return SessionManager.create(projectRoot, directory);
    const sessions = await SessionManager.list(projectRoot, directory);
    if (sessions.length !== files.length) {
      const message = `Session 目录包含 ${files.length - sessions.length} 个损坏或不可读文件：${directory}`;
      if (recovery === "fail") throw new Error(message);
      logger.warn(`${message}；已按 PI_SESSION_RECOVERY=new 创建新会话。`);
      return SessionManager.create(projectRoot, directory);
    }
    return SessionManager.open(sessions[0]!.path, directory, projectRoot);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Session 目录包含")) throw error;
    throw new Error(`Session 目录无法初始化：${directory}；${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export async function createAgentRunner(definition: AgentDefinition, overrides: CreateAgentRunnerOptions = {}, logger: Logger = consoleLogger): Promise<AgentRunner> {
  const config = { ...readRuntimeConfig(), ...overrides }; const resourceMode = config.resourceMode ?? definition.resourceMode ?? "project-only";
  const runtime = await ModelRuntime.create({ authPath: resolve(config.agentDir, "auth.json"), modelsPath: resolve(config.agentDir, "models.json") });
  const requested = config.provider && config.model ? { provider: config.provider, id: config.model } : definition.model;
  const model = selectModel(await runtime.getAvailable(), requested);
  const resourceLoader = await createProjectResourceLoader(definition, resourceMode, config.agentDir, logger);
  const sessionId = config.sessionId ?? defaultSessionId;
  const sessionManager = config.sessionMode === "memory" ? SessionManager.inMemory(projectRoot) : await createPersistentSessionManager(resolveAgentSessionDirectory(definition.id, sessionId, config.sessionDir), config.sessionRecovery, logger);
  const { session } = await createAgentSession({ cwd: projectRoot, agentDir: config.agentDir, modelRuntime: runtime, model, resourceLoader, sessionManager, customTools: definition.tools, tools: definition.activeToolNames });
  const active = session.getActiveToolNames().slice().sort(), expected = definition.activeToolNames.slice().sort();
  if (JSON.stringify(active) !== JSON.stringify(expected)) { session.dispose(); throw new Error(`Agent 工具权限不匹配：期望 ${expected.join(", ")}；实际 ${active.join(", ")}`); }
  for (const name of expected) if (!session.getAllTools().some((tool) => tool.name === name)) { session.dispose(); throw new Error(`Agent 工具定义缺失：${name}`); }
  const metadata = { id: definition.id, description: definition.description, provider: model.provider, model: model.id, resourceMode };
  logger.info(`Agent=${metadata.id} session=${sessionId} persistence=${config.sessionMode} file=${session.sessionFile ?? "memory"} model=${metadata.provider}/${metadata.model} resources=${resourceMode} tools=${active.join(",") || "none"}`);
  return new SdkAgentRunner(session, metadata);
}
