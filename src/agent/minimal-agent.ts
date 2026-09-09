import type { AgentDefinition } from "./definition.js";

export const minimalAgentDefinition: AgentDefinition = {
  id: "minimal",
  description: "不依赖销售数据或项目 skill 的最小助手",
  systemPrompt: "你是简洁、可靠的中文助手。只根据用户提供的信息回答；信息不足时明确说明。",
  tools: [],
  activeToolNames: [],
  resourceMode: "project-only",
};
