import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { encodeHeartbeat, encodeSse, normalizeJson, translateEvent } from "../src/sse.js";

test("SSE encoding is compatible", () => {
  assert.equal(encodeSse({ type: "done", data: {} }), 'data: {"type":"done","data":{}}\n\n');
  assert.equal(encodeHeartbeat(), ": ping\n\n");
});

test("event translation and hostile args are safe", () => {
  const circular: Record<string, unknown> = { big: 1n }; circular.self = circular;
  assert.deepEqual(normalizeJson(circular), { big: "[不可序列化：bigint]", self: "[不可序列化：循环引用]" });
  const event = { type: "tool_execution_start", toolCallId: "1", toolName: "x", args: circular } as AgentSessionEvent;
  assert.equal(translateEvent(event)?.type, "tool_start");
  assert.equal(translateEvent({ type: "agent_settled" }), null);
});

test("text, thinking, and tool results translate with the compatibility limit", () => {
  const text = translateEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "a" } } as AgentSessionEvent);
  const thinking = translateEvent({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "b" } } as AgentSessionEvent);
  const end = translateEvent({ type: "tool_execution_end", toolCallId: "1", toolName: "x", result: { content: [{ type: "text", text: "x".repeat(600) }] }, isError: true } as AgentSessionEvent);
  assert.deepEqual(text, { type: "text", data: { delta: "a" } });
  assert.deepEqual(thinking, { type: "thinking", data: { delta: "b" } });
  assert.equal(end?.type === "tool_end" ? end.data.result.length : 0, 500);
  assert.equal(end?.type === "tool_end" && end.data.isError, true);
});

test("a final model failure is translated into a visible SSE error", () => {
  const event = { type: "agent_end", willRetry: false, messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "upstream unavailable" }] } as AgentSessionEvent;
  assert.deepEqual(translateEvent(event), { type: "error", data: { message: "upstream unavailable" } });
  assert.equal(translateEvent({ ...event, willRetry: true }), null);
});
