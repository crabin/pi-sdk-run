import type { AgentDefinition } from "./definition.js";
import { minimalAgentDefinition } from "./minimal-agent.js";
import { reachAgentDefinition } from "./reach-agent.js";
import { salesAgentDefinition } from "./sales-agent.js";

export const agentRegistry = new Map<string, AgentDefinition>([
  [reachAgentDefinition.id, reachAgentDefinition],
  [salesAgentDefinition.id, salesAgentDefinition],
  [minimalAgentDefinition.id, minimalAgentDefinition],
]);
export const defaultAgentId = reachAgentDefinition.id;
export interface AgentSummary { id: string; description: string }
export function listAgents(): AgentSummary[] {
  return [...agentRegistry.values()].map(({ id, description }) => ({ id, description }));
}
export function getAgentDefinition(id = defaultAgentId): AgentDefinition {
  const definition = agentRegistry.get(id);
  if (!definition) throw new Error(`未知 Agent：${id}。可用 Agent：${[...agentRegistry.keys()].join("、")}`);
  return definition;
}
