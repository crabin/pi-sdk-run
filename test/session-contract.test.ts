import assert from "node:assert/strict";
import test from "node:test";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { createProjectResourceLoader } from "../src/agent/runner.js";
import { salesAgentDefinition } from "../src/agent/sales-agent.js";
import { projectRoot } from "../src/paths.js";

test("real AgentSession applies the exact definition allowlist and custom definitions", async () => {
  const runtime = await ModelRuntime.create();
  const model = runtime.getModel("anthropic", "claude-sonnet-4-5");
  assert.ok(model, "SDK compatibility baseline model must exist in the registry");
  const loader = await createProjectResourceLoader(salesAgentDefinition, "project-only", `${projectRoot}/.pi-config`);
  assert.equal(loader.getExtensions().extensions.length, 0);
  assert.equal(loader.getPrompts().prompts.length, 0);
  assert.equal(loader.getThemes().themes.length, 0);
  assert.equal(loader.getAgentsFiles().agentsFiles.length, 0);
  assert.deepEqual(loader.getSkills().skills.map((skill) => skill.name), ["agent-reach", "dg-piagent"]);
  const { session } = await createAgentSession({ cwd: projectRoot, modelRuntime: runtime, model, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(), customTools: salesAgentDefinition.tools, tools: salesAgentDefinition.activeToolNames });
  try {
    assert.deepEqual(session.getActiveToolNames().slice().sort(), ["bash", "edit", "query_data", "read", "write"]);
    const tools = session.getAllTools();
    for (const name of ["read", "bash", "edit", "write", "query_data"]) assert.ok(tools.find((tool) => tool.name === name)?.description);
  } finally { session.dispose(); }
});
