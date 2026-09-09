import assert from "node:assert/strict";
import test from "node:test";
import { agentRegistry, defaultAgentId, getAgentDefinition, listAgents } from "../src/agent/index.js";
import { parseCliArgs } from "../src/cli.js";
import { parseServerArgs } from "../src/index.js";

test("registry exposes reach, sales and a domain-independent agent", () => {
  assert.deepEqual([...agentRegistry.keys()], ["reach", "sales", "minimal"]);
  assert.equal(getAgentDefinition().id, "reach");
  assert.equal(defaultAgentId, "reach");
  assert.deepEqual(listAgents().map((item) => item.id), ["reach", "sales", "minimal"]);
  assert.deepEqual(Object.keys(listAgents()[0]!).sort(), ["description", "id"]);
  assert.equal(getAgentDefinition("reach").activeToolNames.includes("bash"), true);
  assert.equal(getAgentDefinition("minimal").tools.length, 0);
  assert.throws(() => getAgentDefinition("missing"), /可用 Agent/);
});
test("CLI separates --agent from question text", () => {
  assert.deepEqual(parseCliArgs(["--agent", "minimal", "hello", "world"]), { agentId: "minimal", question: ["hello", "world"] });
  assert.throws(() => parseCliArgs(["--agent"]), /需要/);
});

test("Web separates --agent from server startup", () => {
  assert.deepEqual(parseServerArgs([]), { agentId: undefined });
  assert.deepEqual(parseServerArgs(["--agent", "minimal"]), { agentId: "minimal" });
  assert.throws(() => parseServerArgs(["--agent"]), /需要/);
  assert.throws(() => parseServerArgs(["--unknown"]), /未知参数/);
  assert.throws(() => parseServerArgs(["--agent", "sales", "--agent", "minimal"]), /只能指定一次/);
});
