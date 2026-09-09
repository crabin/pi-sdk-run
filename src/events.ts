export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type StreamEvent =
  | { type: "text"; data: { delta: string } }
  | { type: "thinking"; data: { delta: string } }
  | { type: "tool_start"; data: { id: string; name: string; args: JsonValue } }
  | { type: "tool_end"; data: { id: string; name: string; result: string; isError: boolean } }
  | { type: "error"; data: { message: string } }
  | { type: "done"; data: Record<string, never> };

export type EventHandler = (event: StreamEvent) => void;
export interface AgentMetadata { id: string; description: string; provider: string; model: string; resourceMode: string }
export interface AgentRunner {
  readonly metadata?: AgentMetadata;
  readonly modelName: string;
  readonly isBusy?: boolean;
  prompt(message: string, onEvent: EventHandler, signal?: AbortSignal): Promise<void>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
}
/** @deprecated Use AgentRunner. */
export type DataAgent = AgentRunner;
