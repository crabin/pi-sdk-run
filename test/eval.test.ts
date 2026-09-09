import assert from "node:assert/strict";
import test from "node:test";
import { salesAgentDefinition } from "../src/agent/sales-agent.js";
import { querySales } from "../src/tools/query-data.js";
import { reachAgentDefinition } from "../src/agent/reach-agent.js";

test("eval: single-condition sales query is data-backed", () => assert.match(querySales("地区", "=", "华东").content[0]!.text, /匹配 4\/12/));
test("eval: cross-region inputs produce independently auditable results", () => {
  assert.match(querySales("地区", "=", "华东").content[0]!.text, /华东/); assert.match(querySales("地区", "=", "华南").content[0]!.text, /华南/);
});
test("eval: nonexistent columns fail explicitly", () => assert.equal(querySales("利润", "=", "1").isError, true));
test("eval: prompt forbids fabricated data", () => assert.match(salesAgentDefinition.systemPrompt, /不要编造/));
test("eval: reach research questions require an actual web lookup", () => {
  assert.match(reachAgentDefinition.systemPrompt, /禁止凭记忆直接作答/);
  assert.match(reachAgentDefinition.systemPrompt, /必须先用 read 读取项目中的 skills\/agent-reach\/SKILL\.md/);
  assert.match(reachAgentDefinition.systemPrompt, /至少完成一次有效查询/);
  assert.match(reachAgentDefinition.systemPrompt, /无法完成互联网查询/);
});
test("eval: project skill reading and Pi native tools are available", () => assert.deepEqual(salesAgentDefinition.activeToolNames, ["read", "bash", "edit", "write", "query_data"]));
test("eval: only query_data is a custom tool", () => {
  assert.deepEqual(salesAgentDefinition.tools.map((tool) => tool.name), ["query_data"]);
});
