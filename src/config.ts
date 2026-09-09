import { resolve } from "node:path";
import type { ResourceMode } from "./agent/definition.js";
import { projectRoot } from "./paths.js";

export class ConfigurationError extends Error { readonly code = "configuration"; }
export interface RuntimeConfig { agentDir: string; provider?: string; model?: string; resourceMode?: ResourceMode; host: string; port: number }
export function parsePort(value = "3000"): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65_535) throw new ConfigurationError(`PORT 必须是 1–65535 的整数，收到：${value}`);
  return Number(value);
}
export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const provider = env.PI_PROVIDER?.trim(), model = env.PI_MODEL?.trim();
  if (!!provider !== !!model) throw new ConfigurationError("PI_PROVIDER 和 PI_MODEL 必须同时配置");
  const mode = env.PI_RESOURCE_MODE ?? undefined;
  if (mode !== undefined && mode !== "project-only" && mode !== "inherit-user-resources") throw new ConfigurationError(`PI_RESOURCE_MODE 无效：${mode}`);
  return { agentDir: resolve(projectRoot, env.PI_CODING_AGENT_DIR ?? ".pi-config"), provider, model, resourceMode: mode, host: env.HOST ?? "127.0.0.1", port: parsePort(env.PORT ?? "3000") };
}

export interface AvailableModel { provider: string; id: string; name: string }
export function selectModel<T extends AvailableModel>(models: readonly T[], requested?: { provider: string; id: string }): T {
  if (requested) {
    const exact = models.find((item) => item.provider === requested.provider && item.id === requested.id);
    if (!exact) throw new ConfigurationError(`模型 ${requested.provider}/${requested.id} 不可用。候选：${models.map((m) => `${m.provider}/${m.id}`).join("、") || "无"}`);
    return exact;
  }
  if (models.length !== 1) throw new ConfigurationError(`未显式配置模型，且可用模型数量为 ${models.length}。候选：${models.map((m) => `${m.provider}/${m.id}`).join("、") || "无"}`);
  return models[0]!;
}
