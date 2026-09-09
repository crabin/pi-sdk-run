import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
// @ts-expect-error Browser module intentionally has no TypeScript build step.
import { createSseParser, createToolCard, initializePage, renderMarkdown } from "../public/app.js";

const agentPayload = { defaultAgentId: "reach", initialAgentId: "sales", agents: [{ id: "reach", description: "查找" }, { id: "sales", description: "销售" }] };
const agentResponse = () => ({ ok: true, json: async () => agentPayload });

test("client parser supports chunks, CRLF, heartbeats, and bad frames", () => {
  const events: unknown[] = [], errors: unknown[] = [];
  const parser = createSseParser((event: unknown) => events.push(event), (error: unknown) => errors.push(error));
  parser.push(': ping\r\n\r\ndata: {"type":"te'); parser.push('xt","data":{"delta":"x"}}\n\ndata: bad\n\n');
  assert.equal(events.length, 1); assert.equal(errors.length, 1);
});

test("tool card renders hostile values as text", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const card = createToolCard(dom.window.document, { id: "1", name: '<img src=x onerror="boom">', args: { x: "<script>boom()</script>" } });
  assert.equal(card.querySelectorAll("img,script").length, 0);
  assert.match(card.textContent, /<img/);
});

test("markdown renderer supports rich blocks without executing HTML", () => {
  const dom = new JSDOM("<!doctype html><body><article></article></body>");
  const root = dom.window.document.querySelector("article")!;
  renderMarkdown(dom.window.document, root, '# 标题\n\n**重点** 与 `code`\n\n```js\nconst safe = true;\n```\n\n| A | B |\n| --- | --- |\n| 1 | <script>bad()</script> |');
  assert.equal(root.querySelector("h1")?.textContent, "标题");
  assert.equal(root.querySelector("strong")?.textContent, "重点");
  assert.equal(root.querySelector(".code-bar span")?.textContent, "js");
  assert.equal(root.querySelector("table td")?.textContent, "1");
  assert.equal(root.querySelectorAll("script").length, 0);
  assert.match(root.textContent ?? "", /<script>bad/);
  renderMarkdown(dom.window.document, root, "[危险链接](javascript:alert(1))");
  assert.equal(root.querySelector("a")?.getAttribute("href"), "#");
});

test("chat layout keeps long markdown answers visible and left aligned", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /\.bubble,\.tool,\.think\{flex-shrink:0\}/);
  assert.match(html, /<style>\.bubble\.markdown-body\{align-self:flex-start\}<\/style>/);
});

test("text emitted after a tool is rendered after the tool card", async () => {
  const dom = new JSDOM(`<!doctype html><body><select id="agent"></select><span id="agent-description"></span><div id="chat"><div id="hint"></div></div><textarea id="msg"></textarea><button id="send"></button><button id="stop"></button><span id="dot"></span><span id="status-text"></span></body>`);
  const page = initializePage(dom.window.document, async () => agentResponse());
  await page.loadAgents;

  page.handle({ type: "text", data: { delta: "调用前" } });
  page.handle({ type: "tool_start", data: { id: "call-1", name: "bash", args: { command: "pwd" } } });
  page.handle({ type: "tool_end", data: { id: "call-1", name: "bash", result: "/tmp", isError: false } });
  page.handle({ type: "text", data: { delta: "调用后" } });

  const items = [...dom.window.document.querySelector("#chat")!.children];
  assert.deepEqual(items.slice(1).map((item) => item.className), ["bubble ai markdown-body", "tool", "bubble ai markdown-body"]);
  assert.deepEqual(items.slice(1).map((item) => item.textContent?.includes("调用后")), [false, false, true]);
});

test("server model errors remain visible in the conversation", async () => {
  const dom = new JSDOM(`<!doctype html><body><select id="agent"></select><span id="agent-description"></span><div id="chat"><div id="hint"></div></div><textarea id="msg"></textarea><button id="send"></button><button id="stop"></button><span id="dot"></span><span id="status-text"></span></body>`);
  const page = initializePage(dom.window.document, async () => agentResponse()); await page.loadAgents;
  page.handle({ type: "error", data: { message: "upstream unavailable" } });
  page.handle({ type: "done", data: {} });
  assert.match(dom.window.document.querySelector("#chat")!.textContent ?? "", /出错：upstream unavailable/);
  assert.equal(dom.window.document.querySelector("#status-text")!.textContent, "就绪");
});

test("busy state visibly exposes the stop button and abort restores the UI", async () => {
  const dom = new JSDOM(`<!doctype html><body><select id="agent"></select><span id="agent-description"></span><div id="chat"><div id="hint"></div></div><textarea id="msg"></textarea><button id="send"></button><button id="stop" style="display:none"></button><span id="dot"></span><span id="status-text"></span></body>`, { pretendToBeVisual: true });
  let rejectFetch!: (error: Error) => void;
  const fetchImpl = (url: string, options: { signal: AbortSignal }) => url === "/agents" ? Promise.resolve(agentResponse()) : new Promise((_resolve, reject) => {
    rejectFetch = reject;
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const page = initializePage(dom.window.document, fetchImpl);
  await page.loadAgents;
  const input = dom.window.document.querySelector("#msg") as HTMLTextAreaElement;
  input.value = "hello";
  dom.window.document.querySelector<HTMLButtonElement>("#send")!.click();
  await Promise.resolve();
  assert.equal(dom.window.document.querySelector<HTMLElement>("#stop")!.style.display, "inline-block");
  dom.window.document.querySelector<HTMLButtonElement>("#stop")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector("#status-text")!.textContent, "就绪");
  assert.equal(dom.window.document.querySelector<HTMLElement>("#stop")!.style.display, "none");
  void rejectFetch;
});

test("client loads selection, sends agentId, disables it while busy, and updates description", async () => {
  const dom = new JSDOM(`<!doctype html><body><select id="agent"></select><span id="agent-description"></span><div id="chat"><div id="hint"></div></div><textarea id="msg"></textarea><button id="send"></button><button id="stop"></button><span id="dot"></span><span id="status-text"></span></body>`);
  let requestBody = "";
  const fetchImpl = async (url: string, options?: { body?: string }) => {
    if (url === "/agents") return agentResponse();
    requestBody = options?.body ?? "";
    return { ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"done","data":{}}\n\n')); controller.close(); } }) };
  };
  const page = initializePage(dom.window.document, fetchImpl); await page.loadAgents;
  const select = dom.window.document.querySelector<HTMLSelectElement>("#agent")!;
  assert.equal(select.value, "sales"); assert.equal(dom.window.document.querySelector("#agent-description")!.textContent, "销售");
  select.value = "reach"; select.dispatchEvent(new dom.window.Event("change"));
  (dom.window.document.querySelector("#msg") as HTMLTextAreaElement).value = "hello";
  const sending = page.send(); assert.equal(select.disabled, true); await sending;
  const sent = JSON.parse(requestBody); assert.deepEqual({ agentId: sent.agentId, message: sent.message }, { agentId: "reach", message: "hello" }); assert.match(sent.sessionId, /^[A-Za-z0-9-]+$/); assert.equal(select.disabled, false);
});

test("agent loading failure disables chat and shows a safe error", async () => {
  const dom = new JSDOM(`<!doctype html><body><select id="agent"></select><span id="agent-description"></span><div id="chat"><div id="hint"></div></div><textarea id="msg"></textarea><button id="send"></button><button id="stop"></button><span id="dot"></span><span id="status-text"></span></body>`);
  const page = initializePage(dom.window.document, async () => { throw new Error("offline"); }); await page.loadAgents;
  assert.equal((dom.window.document.querySelector("#send") as HTMLButtonElement).disabled, true);
  assert.match(dom.window.document.querySelector("#chat")!.textContent ?? "", /Agent 列表加载失败/);
});
