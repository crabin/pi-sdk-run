import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { JsonValue, StreamEvent } from "./events.js";

const placeholder = (kind: string): string => `[不可序列化：${kind}]`;

export function normalizeJson(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return placeholder("bigint");
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return placeholder(typeof value);
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return placeholder("循环引用");
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item, seen));
  const output: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    try { output[key] = normalizeJson(item, seen); }
    catch { output[key] = placeholder("读取失败"); }
  }
  return output;
}

export function translateEvent(event: AgentSessionEvent): StreamEvent | null {
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (update.type === "text_delta") return { type: "text", data: { delta: update.delta } };
    if (update.type === "thinking_delta") return { type: "thinking", data: { delta: update.delta } };
    return null;
  }
  if (event.type === "tool_execution_start") {
    return { type: "tool_start", data: { id: event.toolCallId, name: event.toolName, args: normalizeJson(event.args) } };
  }
  if (event.type === "tool_execution_end") {
    const first = event.result?.content?.[0];
    const result = first && first.type === "text" ? first.text : "";
    return {
      type: "tool_end",
      data: { id: event.toolCallId, name: event.toolName, result: result.slice(0, 500), isError: event.isError ?? false },
    };
  }
  return null;
}

export function encodeSse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const encodeHeartbeat = (): string => ": ping\n\n";
