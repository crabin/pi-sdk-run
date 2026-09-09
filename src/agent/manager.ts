import type { AgentRunner } from "../events.js";
import type { AgentDefinition } from "./definition.js";
import { createAgentRunner, type CreateAgentRunnerOptions } from "./runner.js";
import { defaultAgentId, getAgentDefinition, listAgents, type AgentSummary } from "./registry.js";
import { defaultSessionId, validateSessionId } from "../paths.js";

export type AgentRunnerFactory = (definition: AgentDefinition, options?: CreateAgentRunnerOptions) => Promise<AgentRunner>;

export interface AgentProvider {
  list(): AgentSummary[];
  get(id?: string, sessionId?: string): Promise<AgentRunner>;
  dispose(): Promise<void>;
}

export class AgentManager implements AgentProvider {
  private readonly runners = new Map<string, Promise<AgentRunner>>();
  private disposePromise: Promise<void> | undefined;
  private disposed = false;

  constructor(private readonly factory: AgentRunnerFactory = createAgentRunner) {}

  list(): AgentSummary[] { return listAgents(); }

  async get(id = defaultAgentId, sessionId = defaultSessionId): Promise<AgentRunner> {
    if (this.disposed) throw new Error("AgentManager 已释放");
    const definition = getAgentDefinition(id);
    validateSessionId(sessionId);
    const key = `${id}\0${sessionId}`;
    const cached = this.runners.get(key);
    if (cached) return cached;

    const pending = this.factory(definition, { sessionId });
    this.runners.set(key, pending);
    try {
      const runner = await pending;
      if (this.disposed) throw new Error("AgentManager 已释放");
      return runner;
    } catch (error) {
      if (this.runners.get(key) === pending) this.runners.delete(key);
      throw error;
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      const settled = await Promise.allSettled(this.runners.values());
      await Promise.all(settled.flatMap((result) => result.status === "fulfilled" ? [result.value.dispose()] : []));
      this.runners.clear();
    })();
    return this.disposePromise;
  }
}
