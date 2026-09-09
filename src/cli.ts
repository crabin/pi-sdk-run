import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { AgentManager, defaultAgentId, type AgentProvider } from "./agent/index.js";
import type { AgentRunner, StreamEvent } from "./events.js";
import { isMainModule, loadProjectEnv } from "./paths.js";

export interface CliIo { input: Readable; output: Writable; error: Writable }
export function parseCliArgs(args: string[]): { agentId?: string; question: string[] } {
  const question: string[] = []; let agentId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent") { agentId = args[++i]; if (!agentId) throw new Error("--agent 需要一个 ID"); }
    else question.push(args[i]!);
  }
  return { agentId, question };
}

export function renderCliEvent(event: StreamEvent, io: Pick<CliIo, "output" | "error">): void {
  switch (event.type) {
    case "text": io.output.write(event.data.delta); break;
    case "thinking": io.error.write(`[思考] ${event.data.delta}`); break;
    case "tool_start": io.error.write(`\n[工具 ${event.data.name}] ${JSON.stringify(event.data.args).slice(0, 300)}\n`); break;
    case "tool_end": io.error.write(`[工具完成 ${event.data.name}] ${event.data.result.slice(0, 300)}\n`); break;
    case "error": io.error.write(`错误：${event.data.message}\n`); break;
    case "done": io.output.write("\n"); break;
  }
}

async function ask(agent: AgentRunner, question: string, io: CliIo): Promise<boolean> {
  let failed = false;
  try { await agent.prompt(question, (event) => { if (event.type === "error") failed = true; renderCliEvent(event, io); }); }
  catch (error) { failed = true; io.error.write(`错误：${error instanceof Error ? error.message : "Agent 出错"}\n`); }
  if (!failed) renderCliEvent({ type: "done", data: {} }, io);
  return !failed;
}

function showAgents(manager: AgentProvider, currentId: string, io: CliIo): void {
  io.output.write(`当前 Agent：${currentId}\n`);
  for (const item of manager.list()) io.output.write(`${item.id === currentId ? "*" : " "} ${item.id} - ${item.description}\n`);
}

export async function runCli(manager: AgentProvider, initialAgentId: string, args: string[], io: CliIo): Promise<number> {
  let currentId = initialAgentId;
  try {
    let agent = await manager.get(currentId);
    if (args.length > 0) {
      const question = args.join(" ").trim();
      if (!question) { io.error.write("问题不能为空。\n"); return 2; }
      return (await ask(agent, question, io)) ? 0 : 1;
    }
    const readline = createInterface({ input: io.input, output: io.output, terminal: false });
    try {
      io.output.write(`DataAgent Streaming（当前 Agent：${currentId}；输入 /agent 查看或切换）\n`);
      io.output.write("> ");
      for await (const line of readline) {
        const question = line.trim();
        if (question === "exit" || question === "quit") break;
        const command = /^\/agent(?:\s+(.*))?$/.exec(question);
        if (command) {
          const argument = command[1]?.trim();
          if (!argument) showAgents(manager, currentId, io);
          else if (/\s/.test(argument)) io.error.write("用法：/agent <id>\n");
          else {
            try { agent = await manager.get(argument); currentId = argument; io.output.write(`已切换到 Agent：${currentId}\n`); }
            catch (error) { io.error.write(`${error instanceof Error ? error.message : "Agent 切换失败"}\n`); showAgents(manager, currentId, io); }
          }
        } else if (question) await ask(agent, question, io);
        io.output.write("> ");
      }
    } finally { readline.close(); }
    return 0;
  } finally { await manager.dispose(); }
}

export async function main(): Promise<void> {
  loadProjectEnv();
  const parsed = parseCliArgs(process.argv.slice(2));
  const manager = new AgentManager();
  const onSignal = () => void manager.dispose();
  process.once("SIGINT", onSignal);
  try { process.exitCode = await runCli(manager, parsed.agentId ?? defaultAgentId, parsed.question, { input: process.stdin, output: process.stdout, error: process.stderr }); }
  finally { process.off("SIGINT", onSignal); }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
