import { existsSync, realpathSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findProjectRoot(start: string): string {
  let directory = start;
  const root = parse(directory).root;
  while (directory !== root) {
    if (existsSync(resolve(directory, "package.json")) && existsSync(resolve(directory, "skills/dg-piagent/SKILL.md"))) return directory;
    directory = dirname(directory);
  }
  throw new Error("无法从模块位置定位项目根目录");
}

export const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
export const piDirectory = resolve(projectRoot, ".pi");
export const sessionDirectory = resolve(piDirectory, "sessions");
export const dataDirectory = resolve(projectRoot, "data");
export const publicDirectory = resolve(projectRoot, "public");
export const projectSkillsDirectory = resolve(projectRoot, "skills");
export const targetSkillDirectory = resolve(projectSkillsDirectory, "dg-piagent");

export function loadProjectEnv(): void {
  const envFile = resolve(projectRoot, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function isMainModule(moduleUrl: string, entry = process.argv[1]): boolean {
  if (entry === undefined) return false;
  const canonical = (path: string) => existsSync(path) ? realpathSync(path) : resolve(path);
  return canonical(fileURLToPath(moduleUrl)) === canonical(entry);
}

export function resolveAgentDirectory(value = process.env.PI_CODING_AGENT_DIR ?? ".pi-config"): string {
  return resolve(projectRoot, value);
}

export const defaultSessionId = "default";
const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function validateSafePathSegment(value: string, field: string): string {
  if (!safeSegment.test(value)) throw new Error(`${field} 必须是 1–128 位安全标识（仅允许字母、数字、点、下划线和连字符）`);
  return value;
}

export function validateSessionId(value: string): string {
  return validateSafePathSegment(value, "sessionId");
}

export function resolveAgentSessionDirectory(agentId: string, sessionId = defaultSessionId, baseDirectory = sessionDirectory): string {
  validateSafePathSegment(agentId, "agentId");
  validateSessionId(sessionId);
  return resolve(baseDirectory, agentId, sessionId);
}
