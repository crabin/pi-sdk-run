import { once } from "node:events";
import { createServer, type Server } from "node:http";
import express, { type Express, type Request, type Response } from "express";
import type { AgentRunner, StreamEvent } from "./events.js";
import { publicDirectory } from "./paths.js";
import { encodeHeartbeat, encodeSse } from "./sse.js";
import { defaultAgentId, getAgentDefinition, RunnerError, type AgentProvider, type Logger } from "./agent/index.js";

export interface ServerOptions { heartbeatMs?: number; shutdownTimeoutMs?: number; logger?: Logger; initialAgentId?: string }
type ActiveRequest = { agentId: string; abort(): void; finish(): void };

function canWrite(response: Response): boolean { return !response.writableEnded && !response.destroyed; }

export function createApp(manager: AgentProvider, options: ServerOptions = {}) {
  const app = express();
  const active = new Set<ActiveRequest>();
  let closing = false;
  const logger = options.logger ?? console;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const initialAgentId = options.initialAgentId ?? defaultAgentId;
  getAgentDefinition(initialAgentId);

  app.use((request, response, next) => {
    if (request.method === "POST" && request.path === "/chat" && !request.is("application/json")) {
      response.status(400).json({ error: "请求体必须是有效 JSON" });
      return;
    }
    next();
  });
  app.use(express.json());
  app.use(express.static(publicDirectory));
  app.get("/agents", (_request, response) => {
    response.json({ defaultAgentId, initialAgentId, agents: manager.list() });
  });
  app.post("/chat", async (request: Request, response: Response) => {
    const message = request.body?.message;
    if (typeof message !== "string" || message.trim() === "") return response.status(400).json({ error: "message 必须是非空字符串" });
    const requestedAgentId = request.body?.agentId;
    if (requestedAgentId !== undefined && typeof requestedAgentId !== "string") return response.status(400).json({ error: "agentId 必须是字符串" });
    const agentId = requestedAgentId ?? defaultAgentId;
    if (!manager.list().some((item) => item.id === agentId)) return response.status(400).json({ error: `未知 Agent：${agentId}。可用 Agent：${manager.list().map((item) => item.id).join("、")}` });
    if (closing) return response.status(503).json({ error: "服务正在关闭" });
    if ([...active].some((request) => request.agentId === agentId)) return response.status(429).json({ error: "Agent 正忙，稍等" });
    let agent: AgentRunner;
    try { agent = await manager.get(agentId); }
    catch (error) { logger.error("[chat] Agent 创建失败", error); return response.status(500).json({ error: error instanceof Error ? error.message : "Agent 创建失败" }); }
    if (agent.isBusy) return response.status(429).json({ error: "Agent 正忙，稍等" });
    const controller = new AbortController();
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    response.flushHeaders();

    let settled = false, disconnected = false, aborted = false, doneSent = false, cleaned = false, errorSent = false;
    const writeEvent = (event: StreamEvent) => {
      if (!canWrite(response)) return;
      if (event.type === "error") errorSent = true;
      try { response.write(encodeSse(event)); } catch { /* disconnected race */ }
    };
    const heartbeat = setInterval(() => { if (canWrite(response)) response.write(encodeHeartbeat()); }, heartbeatMs);
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      request.off("aborted", disconnect);
      response.off("close", disconnect);
      active.delete(control);
    };
    const abort = () => { if (!settled && !aborted) { aborted = true; controller.abort(); if (agent.isBusy === undefined) void agent.abort(); } };
    const sendDone = () => { if (!doneSent) { doneSent = true; writeEvent({ type: "done", data: {} }); } };
    const finish = () => { abort(); sendDone(); cleanup(); if (canWrite(response)) response.end(); };
    const disconnect = () => { disconnected = true; abort(); cleanup(); };
    const control: ActiveRequest = { agentId, abort, finish };
    active.add(control);
    request.once("aborted", disconnect);
    response.once("close", disconnect);
    try {
      if (!disconnected) await agent.prompt(message.trim(), writeEvent, controller.signal);
    } catch (error) {
      if (!disconnected) {
        if (error instanceof RunnerError && error.code === "busy") logger.warn(`[chat] ${error.message}`);
        logger.error("[chat] Agent 执行失败", error);
        if (!errorSent) writeEvent({ type: "error", data: { message: error instanceof Error ? error.message : "Agent 出错" } });
      }
    } finally {
      settled = true;
      if (!disconnected) sendDone();
      cleanup();
      if (canWrite(response)) response.end();
    }
  });
  app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
    if (error) response.status(400).json({ error: "请求体必须是有效 JSON" });
  });
  return { app, active, setClosing(value: boolean) { closing = value; } };
}

export function createDataAgentServer(manager: AgentProvider, options: ServerOptions = {}) {
  const state = createApp(manager, options);
  const server = createServer(state.app);
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (_reason = "manual") => shutdownPromise ??= (async () => {
    state.setClosing(true);
    const closed = server.listening ? once(server, "close").then(() => undefined) : Promise.resolve();
    if (server.listening) server.close();
    for (const request of [...state.active]) request.finish();
    const timeout = setTimeout(() => server.closeAllConnections(), options.shutdownTimeoutMs ?? 5_000);
    try { await closed; } finally { clearTimeout(timeout); await manager.dispose(); }
  })();
  return { app: state.app, server, shutdown };
}
