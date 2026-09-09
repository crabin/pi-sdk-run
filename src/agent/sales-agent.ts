import type { AgentDefinition } from "./definition.js";
import { queryDataTool } from "../tools/query-data.js";

export const salesAgentDefinition: AgentDefinition = {
  id: "sales",
  description: "基于随附 CSV 的销售数据分析助手",
  systemPrompt: "你是企业数据分析助手。回答必须基于 query_data 工具查到的真实销售数据，不要编造数字。用中文，结论先行，必要时给出明细。需要 Pi SDK 开发资料时，可用 Pi 原生 read 工具读取项目 skill。",
  tools: [queryDataTool],
  activeToolNames: ["read", "bash", "edit", "write", "query_data"],
  requiredSkillNames: ["dg-piagent", "agent-reach"],
  resourceMode: "project-only",
};
