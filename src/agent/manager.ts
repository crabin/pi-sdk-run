import type { AgentRunner } from "../events.js";
import type { AgentDefinition } from "./definition.js";
import { createAgentRunner } from "./runner.js";
import { defaultAgentId, getAgentDefinition, listAgents, type AgentSummary } from "./registry.js";

export type AgentRunnerFactory = (definition: AgentDefinition) => Promise<AgentRunner>;

export interface AgentProvider {
  list(): AgentSummary[];
  get(id?: string): Promise<AgentRunner>;
  dispose(): Promise<void>;
}

export class AgentManager implements AgentProvider {
  private readonly runners = new Map<string, Promise<AgentRunner>>();
  private disposePromise: Promise<void> | undefined;
  private disposed = false;

  constructor(private readonly factory: AgentRunnerFactory = createAgentRunner) {}

  list(): AgentSummary[] { return listAgents(); }

  async get(id = defaultAgentId): Promise<AgentRunner> {
    if (this.disposed) throw new Error("AgentManager 已释放");
    const definition = getAgentDefinition(id);
    const cached = this.runners.get(id);
    if (cached) return cached;

    const pending = this.factory(definition);
    this.runners.set(id, pending);
    try {
      const runner = await pending;
      if (this.disposed) throw new Error("AgentManager 已释放");
      return runner;
    } catch (error) {
      if (this.runners.get(id) === pending) this.runners.delete(id);
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
