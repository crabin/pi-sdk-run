import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { runCli } from "../src/cli.js";
import type { AgentProvider } from "../src/agent/index.js";
import type { AgentRunner } from "../src/events.js";

function sink() { let text = ""; return { stream: new Writable({ write(chunk, _encoding, done) { text += chunk; done(); } }), read: () => text }; }
function fakeManager() {
  const prompts: string[] = [], created: string[] = []; let disposals = 0;
  const runners = new Map<string, AgentRunner>();
  const manager: AgentProvider = {
    list: () => [{ id: "reach", description: "查找" }, { id: "sales", description: "销售" }],
    async get(id = "reach") {
      if (!this.list().some((item) => item.id === id)) throw new Error(`未知 Agent：${id}。可用 Agent：reach、sales`);
      let agent = runners.get(id);
      if (!agent) { created.push(id); agent = { modelName: id, async prompt(message, emit) { prompts.push(`${id}:${message}`); emit({ type: "text", data: { delta: `答:${message}` } }); }, async abort() {}, async dispose() {} }; runners.set(id, agent); }
      return agent;
    },
    async dispose() { disposals++; },
  };
  return { manager, prompts, created, disposals: () => disposals };
}

test("single CLI joins arguments and disposes", async () => {
  const fake = fakeManager(), output = sink(), error = sink();
  assert.equal(await runCli(fake.manager, "reach", ["hello", "world"], { input: Readable.from([]), output: output.stream, error: error.stream }), 0);
  assert.deepEqual(fake.prompts, ["reach:hello world"]); assert.equal(fake.disposals(), 1); assert.match(output.read(), /答:hello world/);
});

test("interactive CLI lists, switches, and reuses agents", async () => {
  const fake = fakeManager(), output = sink(), error = sink();
  await runCli(fake.manager, "reach", [], { input: Readable.from(["/agent\n", "/agent sales\n", "one\n", "/agent reach\n", "two\n", "exit\n"]), output: output.stream, error: error.stream });
  assert.deepEqual(fake.prompts, ["sales:one", "reach:two"]); assert.deepEqual(fake.created, ["reach", "sales"]); assert.equal(fake.disposals(), 1);
  assert.match(output.read(), /当前 Agent：reach/); assert.match(output.read(), /已切换到 Agent：sales/);
});

test("unknown and malformed agent commands do not exit interactive mode", async () => {
  const fake = fakeManager(), output = sink(), error = sink();
  await runCli(fake.manager, "reach", [], { input: Readable.from(["/agent missing\n", "/agent sales extra\n", "still here\n", "quit\n"]), output: output.stream, error: error.stream });
  assert.deepEqual(fake.prompts, ["reach:still here"]); assert.match(error.read(), /未知 Agent/); assert.match(error.read(), /用法/);
});

test("blank single question is usage error and still disposes", async () => {
  const fake = fakeManager(), output = sink(), error = sink();
  assert.equal(await runCli(fake.manager, "reach", ["   "], { input: Readable.from([]), output: output.stream, error: error.stream }), 2);
  assert.equal(fake.disposals(), 1); assert.match(error.read(), /不能为空/);
});
