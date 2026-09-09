import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createPersistentSessionManager } from "../src/agent/runner.js";
import { defaultSessionId, projectRoot, resolveAgentSessionDirectory, validateSessionId } from "../src/paths.js";

test("session paths are project-local and isolated by agent and session", async () => {
  const base = await mkdtemp(join(tmpdir(), "pi-sdk-session-"));
  assert.equal(defaultSessionId, "default");
  assert.equal(resolveAgentSessionDirectory("reach", "work", base), join(base, "reach", "work"));
  assert.notEqual(resolveAgentSessionDirectory("reach", "work", base), resolveAgentSessionDirectory("sales", "work", base));
  assert.throws(() => validateSessionId("../escape"), /安全标识/);
  assert.throws(() => validateSessionId(""), /安全标识/);

  const directory = resolveAgentSessionDirectory("reach", "work", base);
  const manager = SessionManager.create(projectRoot, directory);
  const file = manager.getSessionFile();
  assert.ok(file?.startsWith(`${directory}/`));
  manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() } as never);
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "持久化测试" }], api: "openai-completions", provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: "stop", timestamp: Date.now() } as never);
  assert.match(await readFile(file!, "utf8"), /持久化测试/);

  const listed = await SessionManager.list(projectRoot, directory);
  assert.equal(listed.length, 1);
  const continued = SessionManager.continueRecent(projectRoot, directory);
  assert.equal(continued.getSessionFile(), file);
});

test("application persistence wrapper restores context across manager lifetimes", async () => {
  const base = await mkdtemp(join(tmpdir(), "pi-sdk-restart-"));
  const directory = resolveAgentSessionDirectory("reach", "restart", base);
  const first = await createPersistentSessionManager(directory, "fail");
  first.appendMessage({ role: "user", content: "remember-me", timestamp: Date.now() } as never);
  first.appendMessage({ role: "assistant", content: [{ type: "text", text: "remembered" }], api: "openai-completions", provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: "stop", timestamp: Date.now() } as never);
  const restored = await createPersistentSessionManager(directory, "fail");
  assert.match(JSON.stringify(restored.buildSessionContext()), /remember-me/);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
});

test("corrupt sessions fail explicitly or create a new session only when configured", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-sdk-corrupt-"));
  await writeFile(join(directory, "broken.jsonl"), "{broken\n");
  await assert.rejects(createPersistentSessionManager(directory, "fail"), /损坏或不可读/);
  const warnings: string[] = [];
  const recovered = await createPersistentSessionManager(directory, "new", { info() {}, warn(message) { warnings.push(message); }, error() {} });
  assert.match(recovered.getSessionFile() ?? "", /\.jsonl$/);
  assert.match(warnings[0] ?? "", /PI_SESSION_RECOVERY=new/);
});

test("session directory initialization reports filesystem failures with its path", async () => {
  const base = await mkdtemp(join(tmpdir(), "pi-sdk-unwritable-"));
  const file = join(base, "not-a-directory");
  await writeFile(file, "occupied");
  await assert.rejects(createPersistentSessionManager(file, "fail"), (error: unknown) => error instanceof Error && /Session 目录无法初始化/.test(error.message) && error.message.includes(file));
});
