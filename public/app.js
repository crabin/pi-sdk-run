export function createSseParser(onEvent, onError) {
  let buffer = "";
  const parseFrame = (raw) => {
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const payload = lines.filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, "")).join("\n");
    if (!payload) return;
    try { onEvent(JSON.parse(payload)); } catch (error) { onError(error); }
  };
  return {
    push(chunk) { buffer += chunk; let match; while ((match = /\r?\n\r?\n/.exec(buffer))) { parseFrame(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length); } },
    finish() { if (buffer.trim()) parseFrame(buffer); buffer = ""; },
  };
}

export function createToolCard(document, data) {
  const card = document.createElement("div"); card.className = "tool"; card.id = `tool-${data.id}`;
  const head = document.createElement("div"); head.className = "t-head"; head.textContent = `🔧 ${data.name}`;
  const args = document.createElement("div"); args.className = "t-args"; args.textContent = JSON.stringify(data.args);
  const status = document.createElement("div"); status.className = "t-status"; status.textContent = "执行中…";
  const loading = document.createElement("span"); loading.className = "loading";
  for (let index = 0; index < 3; index++) loading.appendChild(document.createElement("span"));
  status.appendChild(loading); card.append(head, args, status); return card;
}

function safeUrl(value, image = false) {
  const normalized = value.trim().toLowerCase();
  if (/^(?:https?:|\/|\.\/|\.\.\/|#)/.test(normalized)) return value;
  if (!image && /^(?:mailto:|tel:)/.test(normalized)) return value;
  return "#";
}

function appendInlineMarkdown(document, parent, source) {
  const pattern = /(`+)([\s\S]*?)\1|!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let cursor = 0, match;
  while ((match = pattern.exec(source))) {
    if (match.index > cursor) parent.appendChild(document.createTextNode(source.slice(cursor, match.index)));
    if (match[1]) { const code = document.createElement("code"); code.textContent = match[2]; parent.appendChild(code); }
    else if (match[3] !== undefined) {
      const image = document.createElement("img"); image.alt = match[3]; image.src = safeUrl(match[4], true); image.loading = "lazy"; parent.appendChild(image);
    } else if (match[5] !== undefined) {
      const link = document.createElement("a"); link.textContent = match[5]; link.href = safeUrl(match[6]); link.target = "_blank"; link.rel = "noopener noreferrer"; parent.appendChild(link);
    } else {
      const tag = match[7] || match[8] ? "strong" : match[9] ? "del" : "em";
      const node = document.createElement(tag); node.textContent = match[7] || match[8] || match[9] || match[10] || match[11]; parent.appendChild(node);
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < source.length) parent.appendChild(document.createTextNode(source.slice(cursor)));
}

function isBlockStart(line) {
  return /^\s*(?:```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s|---+\s*$|\|)/.test(line);
}

export function renderMarkdown(document, root, markdown) {
  root.replaceChildren();
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = /^\s*```([^\s`]*)\s*$/.exec(line);
    if (fence) {
      const content = []; index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) content.push(lines[index++]);
      if (index < lines.length) index++;
      const frame = document.createElement("div"); frame.className = "code-frame";
      const bar = document.createElement("div"); bar.className = "code-bar";
      const language = document.createElement("span"); language.textContent = fence[1] || "代码";
      const copy = document.createElement("button"); copy.type = "button"; copy.className = "copy-code"; copy.textContent = "复制";
      const value = content.join("\n");
      copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(value); copy.textContent = "已复制"; setTimeout(() => { copy.textContent = "复制"; }, 1500); } catch { copy.textContent = "复制失败"; } });
      const pre = document.createElement("pre"), code = document.createElement("code"); code.textContent = value; pre.appendChild(code); bar.append(language, copy); frame.append(bar, pre); root.appendChild(frame); continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { const node = document.createElement(`h${heading[1].length}`); appendInlineMarkdown(document, node, heading[2]); root.appendChild(node); index++; continue; }
    if (/^\s*---+\s*$/.test(line)) { root.appendChild(document.createElement("hr")); index++; continue; }
    if (/^\s*>/.test(line)) {
      const quote = document.createElement("blockquote"), parts = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) parts.push(lines[index++].replace(/^\s*>\s?/, ""));
      appendInlineMarkdown(document, quote, parts.join("\n")); root.appendChild(quote); continue;
    }
    const listMatch = /^\s*([-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]), list = document.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const itemMatch = /^\s*([-*+]|\d+[.)])\s+(.+)$/.exec(lines[index]);
        if (!itemMatch || /\d/.test(itemMatch[1]) !== ordered) break;
        const item = document.createElement("li"); appendInlineMarkdown(document, item, itemMatch[2]); list.appendChild(item); index++;
      }
      root.appendChild(list); continue;
    }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const split = (value) => value.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => cell.trim());
      const rows = [split(line)]; index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(split(lines[index++]));
      const wrap = document.createElement("div"); wrap.className = "table-wrap"; const table = document.createElement("table");
      rows.forEach((row, rowIndex) => { const tr = document.createElement("tr"); row.forEach((cell) => { const node = document.createElement(rowIndex ? "td" : "th"); appendInlineMarkdown(document, node, cell); tr.appendChild(node); }); (rowIndex ? table.tBodies[0] || table.createTBody() : table.createTHead()).appendChild(tr); });
      wrap.appendChild(table); root.appendChild(wrap); continue;
    }
    const paragraph = document.createElement("p"), parts = [line]; index++;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) parts.push(lines[index++]);
    parts.forEach((part, partIndex) => { if (partIndex) paragraph.appendChild(document.createElement("br")); appendInlineMarkdown(document, paragraph, part); });
    root.appendChild(paragraph);
  }
}

export function initializePage(document, fetchImpl = fetch) {
  const chat = document.getElementById("chat"), input = document.getElementById("msg"), sendButton = document.getElementById("send"), stopButton = document.getElementById("stop"), agentSelect = document.getElementById("agent"), agentDescription = document.getElementById("agent-description"), dot = document.getElementById("dot"), statusText = document.getElementById("status-text"), hint = document.getElementById("hint");
  let bubble, thinking, busy = false, ready = false, controller, agents = [], answerText = "";
  const updateDescription = () => { if (agentDescription) agentDescription.textContent = agents.find((item) => item.id === agentSelect?.value)?.description ?? ""; };
  const setBusy = (value) => { busy = value; sendButton.style.display = value ? "none" : "inline-block"; stopButton.style.display = value ? "inline-block" : "none"; sendButton.disabled = !ready || value; input.disabled = !ready || value; if (agentSelect) agentSelect.disabled = !ready || value; dot.className = value ? "busy" : ""; statusText.textContent = value ? "思考中…" : ready ? "就绪" : "Agent 不可用"; if (!value && ready) input.focus(); };
  const showError = (message) => { const node = document.createElement("div"); node.className = "bubble ai error"; node.textContent = message; chat.appendChild(node); };
  const handle = ({ type, data }) => {
    if (type === "text") { if (!bubble || bubble.dataset.done) { hint.style.display = "none"; bubble = document.createElement("article"); bubble.className = "bubble ai markdown-body"; answerText = ""; chat.appendChild(bubble); } answerText += data.delta; renderMarkdown(document, bubble, answerText); }
    else if (type === "thinking") { if (!thinking) { thinking = document.createElement("div"); thinking.className = "think"; chat.appendChild(thinking); } thinking.textContent += data.delta; }
    else if (type === "tool_start") {
      // A tool call is a boundary between assistant content blocks. Finalize the
      // current bubble so text emitted after the tool result is rendered after
      // the tool card instead of being appended to a bubble before it.
      if (bubble) bubble.dataset.done = "1";
      bubble = undefined; answerText = "";
      chat.appendChild(createToolCard(document, data));
      thinking = undefined;
    }
    else if (type === "tool_end") { const card = document.getElementById(`tool-${data.id}`); if (card) { let result = card.querySelector(".t-res"); if (!result) { result = document.createElement("div"); card.appendChild(result); } result.className = `t-res${data.isError ? " err" : ""}`; result.textContent = `${data.isError ? "❌" : "✅"} ${data.result}`; const status = card.querySelector(".t-status"); if (status) status.textContent = "完成"; } }
    else if (type === "error") showError(`出错：${data.message}`);
    else if (type === "done") { if (bubble) bubble.dataset.done = "1"; thinking = undefined; setBusy(false); }
    chat.scrollTop = chat.scrollHeight;
  };
  async function send() {
    const message = input.value.trim(); if (!message || busy || !ready || !agentSelect?.value) return;
    setBusy(true); const user = document.createElement("div"); user.className = "bubble user"; user.textContent = message; chat.appendChild(user); input.value = ""; bubble = undefined; thinking = undefined; answerText = "";
    controller = new AbortController(); let receivedDone = false;
    try {
      const response = await fetchImpl("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: agentSelect.value, message }), signal: controller.signal });
      if (!response.ok) { let detail = {}; try { detail = await response.json(); } catch {} throw new Error(detail.error || `HTTP ${response.status}`); }
      if (!response.body) throw new Error("服务器没有返回响应流");
      const parser = createSseParser((event) => { if (event.type === "done") receivedDone = true; handle(event); }, () => showError("收到无法解析的流数据"));
      const reader = response.body.getReader(), decoder = new TextDecoder();
      while (true) { const { done, value } = await reader.read(); if (done) break; parser.push(decoder.decode(value, { stream: true })); }
      parser.push(decoder.decode()); parser.finish(); if (!receivedDone) throw new Error("连接在完成前中断");
    } catch (error) { if (error.name !== "AbortError") showError(`请求失败：${error.message}`); setBusy(false); }
    finally { controller = undefined; }
  }
  sendButton.addEventListener("click", send); stopButton.addEventListener("click", () => controller?.abort());
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } });
  agentSelect?.addEventListener("change", updateDescription);
  const loadAgents = (async () => {
    try {
      const response = await fetchImpl("/agents");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.agents) || payload.agents.length === 0) throw new Error("Agent 列表为空");
      agents = payload.agents.filter((item) => typeof item?.id === "string" && typeof item?.description === "string");
      if (agents.length === 0) throw new Error("Agent 列表无效");
      if (agentSelect) {
        agentSelect.replaceChildren(...agents.map((item) => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.id; return option; }));
        agentSelect.value = agents.some((item) => item.id === payload.initialAgentId) ? payload.initialAgentId : payload.defaultAgentId;
      }
      ready = true; updateDescription(); setBusy(false);
    } catch (error) {
      ready = false; setBusy(false); showError(`Agent 列表加载失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  })();
  return { send, handle, loadAgents };
}

if (typeof document !== "undefined") initializePage(document);
