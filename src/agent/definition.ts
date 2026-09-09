import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type ResourceMode = "project-only" | "inherit-user-resources";
export interface AgentDefinition {
  id: string;
  description: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  activeToolNames: string[];
  requiredSkillNames?: string[];
  resourceMode?: ResourceMode;
  model?: { provider: string; id: string };
}
