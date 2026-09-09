import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { DataAgent } from "../src/events.js";
import type { AgentProvider } from "../src/agent/index.js";
import { createDataAgentServer } from "../src/server.js";

function makeAgent(promptImpl?: DataAgent["prompt"]) {
  let aborts = 0, disposals = 0;
  const agent: DataAgent = {
    modelName: "fake",
    prompt: promptImpl ?? (async (_message, emit) => emit({ type: "text", data: { delta: "ok" } })),
    abort() { aborts++; },
    async dispose() { disposals++; },
  };
  return { agent, aborts: () => aborts, disposals: () => disposals };
}

function provider(agents: Record<string, DataAgent>, onDispose?: () => void): AgentProvider {
  return {
    list: () => Object.keys(agents).map((id) => ({ id, description: `${id} agent` })),
    async get(id = "reach") { const agent = agents[id]; if (!agent) throw new Error(`未知 Agent：${id}`); return agent; },
    async dispose() { for (const agent of Object.values(agents)) await agent.dispose(); onDispose?.(); },
  };
}

async function start(agent: DataAgent) {
  const service = createDataAgentServer(provider({ reach: agent }), { heartbeatMs: 10 });
  service.server.listen(0, "127.0.0.1"); await once(service.server, "listening");
  const port = (service.server.address() as AddressInfo).port;
  return { ...service, url: `http://127.0.0.1:${port}` };
}

test("chat validates input and streams exactly one done", async () => {
  const fake = makeAgent(), service = await start(fake.agent);
  try {
    const invalid = await fetch(`${service.url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: " " }) });
    assert.equal(invalid.status, 400);
    const response = await fetch(`${service.url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(response.headers.get("connection"), "keep-alive");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const body = await response.text();
    assert.match(body, /"type":"text"/);
    assert.equal(body.match(/"type":"done"/g)?.length, 1);
  } finally { await service.shutdown(); }
  assert.equal(fake.disposals(), 1);
});

test("malformed and non-JSON requests return the same safe JSON error", async () => {
  const fake = makeAgent(), service = await start(fake.agent);
  try {
    const malformed = await fetch(`${service.url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    const plain = await fetch(`${service.url}/chat`, { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" });
    assert.equal(malformed.status, 400); assert.equal(plain.status, 400);
    assert.deepEqual(await malformed.json(), { error: "请求体必须是有效 JSON" });
    assert.deepEqual(await plain.json(), { error: "请求体必须是有效 JSON" });
  } finally { await service.shutdown(); }
});

test("agent failure yields error then done and releases busy", async () => {
  const fake = makeAgent(async () => { throw new Error("broken"); });
  const logs: unknown[] = [];
  const service = createDataAgentServer(provider({ reach: fake.agent }), { logger: { info() {}, warn() {}, error(...args) { logs.push(args); } } });
  service.server.listen(0, "127.0.0.1"); await once(service.server, "listening");
  const url = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"message":"hi"}' });
    const body = await response.text(); assert.ok(body.indexOf('"type":"error"') < body.indexOf('"type":"done"')); assert.equal(logs.length, 1);
  } finally { await service.shutdown(); }
});

test("busy request gets 429 and shutdown is idempotent", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const fake = makeAgent(async () => pending);
  const service = createDataAgentServer(provider({ reach: fake.agent }), { heartbeatMs: 10, shutdownTimeoutMs: 50 });
  service.server.listen(0, "127.0.0.1"); await once(service.server, "listening");
  const serviceUrl = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const first = fetch(`${serviceUrl}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"message":"one"}' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await fetch(`${serviceUrl}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"message":"two"}' });
  assert.equal(second.status, 429);
  const closingA = service.shutdown(), closingB = service.shutdown(); release(); await Promise.all([closingA, closingB, first]);
  assert.equal(fake.aborts(), 1); assert.equal(fake.disposals(), 1);
});

test("shutdown waits for an active prompt to settle before disposing the manager", async () => {
  let release!: () => void, settled = false, disposedAfterSettle = false;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const agent: DataAgent = {
    modelName: "fake",
    async prompt() { try { await pending; } finally { settled = true; } },
    async abort() { setTimeout(release, 20); },
    async dispose() { disposedAfterSettle = settled; },
  };
  const service = createDataAgentServer(provider({ reach: agent }), { heartbeatMs: 10 });
  service.server.listen(0, "127.0.0.1"); await once(service.server, "listening");
  const url = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const request = fetch(`${url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"message":"wait"}' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await service.shutdown(); await request;
  assert.equal(settled, true); assert.equal(disposedAfterSettle, true);
});

test("agents endpoint exposes safe summaries and startup selection", async () => {
  const fake = makeAgent(), sales = makeAgent();
  const service = createDataAgentServer(provider({ reach: fake.agent, sales: sales.agent }), { initialAgentId: "sales" });
  service.server.listen(0, "127.0.0.1"); await once(service.server, "listening");
  const url = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${url}/agents`);
    assert.deepEqual(await response.json(), { defaultAgentId: "reach", initialAgentId: "sales", agents: [{ id: "reach", description: "reach agent" }, { id: "sales", description: "sales agent" }] });
  } finally { await service.shutdown(); }
});

test("chat routes by agent, defaults to reach, and validates agentId before SSE", async () => {
  const messages: string[] = [];
  const reach = makeAgent(async (message) => { messages.push(`reach:${message}`); });
  const sales = makeAgent(async (message) => { messages.push(`sales:${message}`); });
  const service = createDataAgentServer(provider({ reach: reach.agent, sales: sales.agent }));
  service.server.listen(0, "127.0.0.1"); await once(service.server, "listening");
  const url = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  try {
    await (await fetch(`${url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"message":"a"}' })).text();
    await (await fetch(`${url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"agentId":"sales","message":"b"}' })).text();
    assert.deepEqual(messages, ["reach:a", "sales:b"]);
    for (const agentId of [42, "missing"]) {
      const response = await fetch(`${url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId, message: "x" }) });
      assert.equal(response.status, 400); assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    }
  } finally { await service.shutdown(); }
});

test("busy state is isolated per agent", async () => {
  let release!: () => void;
  const reach = makeAgent(async () => new Promise<void>((resolve) => { release = resolve; }));
  const sales = makeAgent();
  const service = createDataAgentServer(provider({ reach: reach.agent, sales: sales.agent }), { heartbeatMs: 10 });
  service.server.listen(0, "127.0.0.1"); await once(service.server, "listening");
  const url = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const first = fetch(`${url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"agentId":"reach","message":"one"}' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const busy = await fetch(`${url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"agentId":"reach","message":"two"}' });
  const independent = await fetch(`${url}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"agentId":"sales","message":"three"}' });
  assert.equal(busy.status, 429); assert.equal(independent.status, 200);
  release(); await first; await service.shutdown();
});

test("chat reserves a cold session before runner creation and isolates different sessions", async () => {
  const requests: string[] = [];
  const releases = new Map<string, () => void>();
  const agents = new Map<string, DataAgent>();
  const manager: AgentProvider = {
    list: () => [{ id: "reach", description: "reach agent" }],
    async get(_id = "reach", sessionId = "default") {
      requests.push(`create:${sessionId}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      let agent = agents.get(sessionId);
      if (!agent) {
        agent = makeAgent(async () => new Promise<void>((resolve) => { releases.set(sessionId, resolve); })).agent;
        agents.set(sessionId, agent);
      }
      return agent;
    },
    async dispose() { for (const agent of agents.values()) await agent.dispose(); },
  };
  const service = createDataAgentServer(manager);
  service.server.listen(0, "127.0.0.1"); await once(service.server, "listening");
  const url = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  try {
    const headers = { "content-type": "application/json" };
    const first = fetch(`${url}/chat`, { method: "POST", headers, body: '{"sessionId":"one","message":"a"}' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const duplicate = await fetch(`${url}/chat`, { method: "POST", headers, body: '{"sessionId":"one","message":"duplicate"}' });
    assert.equal(duplicate.status, 429);
    const independent = fetch(`${url}/chat`, { method: "POST", headers, body: '{"sessionId":"two","message":"b"}' });
    while (!releases.has("one") || !releases.has("two")) await new Promise((resolve) => setTimeout(resolve, 2));
    assert.deepEqual(requests.sort(), ["create:one", "create:two"]);
    releases.get("one")!(); releases.get("two")!();
    assert.equal((await first).status, 200); assert.equal((await independent).status, 200);
    const invalid = await fetch(`${url}/chat`, { method: "POST", headers, body: '{"sessionId":"../escape","message":"x"}' });
    assert.equal(invalid.status, 400);
  } finally { await service.shutdown(); }
});
