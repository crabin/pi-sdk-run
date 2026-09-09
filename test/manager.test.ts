import assert from "node:assert/strict";
import test from "node:test";
import { AgentManager } from "../src/agent/index.js";
import type { AgentRunner } from "../src/events.js";

function runner() {
  let disposals = 0;
  const value: AgentRunner = { modelName: "fake", async prompt() {}, async abort() {}, async dispose() { disposals++; } };
  return { value, disposals: () => disposals };
}

test("manager lists registry summaries without exposing definitions", () => {
  const manager = new AgentManager(async () => runner().value);
  assert.deepEqual(manager.list().map((item) => item.id), ["reach", "sales", "minimal"]);
  assert.deepEqual(Object.keys(manager.list()[0]!).sort(), ["description", "id"]);
});

test("manager lazily creates and reuses independent runners", async () => {
  const created: string[] = [];
  const manager = new AgentManager(async (definition, options) => { created.push(`${definition.id}:${options?.sessionId}`); return runner().value; });
  const [first, concurrent] = await Promise.all([manager.get("reach"), manager.get("reach")]);
  const named = await manager.get("reach", "work");
  const other = await manager.get("sales");
  assert.equal(first, concurrent); assert.notEqual(first, named); assert.notEqual(first, other); assert.deepEqual(created, ["reach:default", "reach:work", "sales:default"]);
  await manager.dispose();
});

test("manager retries failed creation and disposes each runner exactly once", async () => {
  let attempts = 0;
  const fake = runner();
  const manager = new AgentManager(async () => { if (++attempts === 1) throw new Error("temporary"); return fake.value; });
  await assert.rejects(manager.get(), /temporary/);
  assert.equal(await manager.get(), fake.value); assert.equal(attempts, 2);
  await Promise.all([manager.dispose(), manager.dispose()]);
  assert.equal(fake.disposals(), 1);
  await assert.rejects(manager.get(), /已释放/);
});

test("manager rejects unknown agents without invoking the factory", async () => {
  let calls = 0;
  const manager = new AgentManager(async () => { calls++; return runner().value; });
  await assert.rejects(manager.get("missing"), /未知 Agent/); assert.equal(calls, 0);
  await manager.dispose();
});
