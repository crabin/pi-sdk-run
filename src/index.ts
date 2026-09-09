import { AgentManager, defaultAgentId, getAgentDefinition } from "./agent/index.js";
import { createDataAgentServer } from "./server.js";
import { isMainModule, loadProjectEnv } from "./paths.js";
import { parsePort, readRuntimeConfig } from "./config.js";

export { parsePort };

export function parseServerArgs(args: string[]): { agentId?: string } {
  let agentId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--agent") throw new Error(`未知参数：${args[i]}`);
    if (agentId !== undefined) throw new Error("--agent 只能指定一次");
    agentId = args[++i];
    if (!agentId) throw new Error("--agent 需要一个 ID");
  }
  return { agentId };
}

export async function main(): Promise<void> {
  loadProjectEnv();
  const config = readRuntimeConfig();
  const { agentId } = parseServerArgs(process.argv.slice(2));
  const initialAgentId = agentId ?? defaultAgentId;
  getAgentDefinition(initialAgentId);
  const manager = new AgentManager();
  const { host, port } = config;
  const application = createDataAgentServer(manager, { initialAgentId });
  const close = async (signal: string) => { await application.shutdown(signal); process.exitCode = 0; };
  const onSigint = () => void close("SIGINT");
  const onSigterm = () => void close("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  application.server.once("close", () => { process.off("SIGINT", onSigint); process.off("SIGTERM", onSigterm); });
  application.server.listen(port, host, () => {
    console.log(`DataAgent Web：http://${host}:${port}`);
    console.log(`初始 Agent：${initialAgentId}（Runner 将在首次请求时创建）`);
  });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
