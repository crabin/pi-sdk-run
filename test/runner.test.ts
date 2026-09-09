import assert from "node:assert/strict";
import test from "node:test";
import { RunnerError, SdkAgentRunner } from "../src/agent/runner.js";

function fakeSession() {
  let listener: ((event: unknown) => void) | undefined, unsubscribes = 0, aborts = 0, disposals = 0, release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const session = { isStreaming: false, subscribe(fn: (event: unknown) => void) { listener = fn; return () => { listener = undefined; unsubscribes++; }; },
    async prompt() { session.isStreaming = true; try { await pending; } finally { session.isStreaming = false; } },
    async abort() { aborts++; release(); }, dispose() { disposals++; } };
  return { session, release, values: () => ({ listener, unsubscribes, aborts, disposals }) };
}
const metadata = { id: "x", description: "x", provider: "p", model: "m", resourceMode: "project-only" };
test("runner owns concurrency, abort, unsubscribe and idempotent disposal", async () => {
  const fake = fakeSession(); const runner = new SdkAgentRunner(fake.session as never, metadata);
  const first = runner.prompt("one", () => {}); await Promise.resolve();
  await assert.rejects(runner.prompt("two", () => {}), (error) => error instanceof RunnerError && error.code === "busy");
  await runner.abort(); await first; assert.equal(fake.values().unsubscribes, 1); assert.equal(fake.values().aborts, 1);
  await runner.dispose(); await runner.dispose(); assert.equal(fake.values().disposals, 1);
  await assert.rejects(runner.prompt("three", () => {}), /释放/);
});
