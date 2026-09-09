import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, readRuntimeConfig, selectModel } from "../src/config.js";

const models = [
  { provider: "alpha", id: "same", name: "A" },
  { provider: "beta", id: "same", name: "B" },
];
test("model selection requires provider and id and ignores list order", () => {
  assert.equal(selectModel(models, { provider: "beta", id: "same" }).name, "B");
  assert.equal(selectModel([...models].reverse(), { provider: "beta", id: "same" }).name, "B");
  assert.throws(() => selectModel(models), ConfigurationError);
  assert.throws(() => selectModel([], { provider: "x", id: "y" }), /候选/);
  assert.equal(selectModel([models[0]!]).name, "A");
});
test("runtime configuration rejects partial and invalid values", () => {
  assert.throws(() => readRuntimeConfig({ PI_PROVIDER: "alpha" }), /同时配置/);
  assert.throws(() => readRuntimeConfig({ PI_RESOURCE_MODE: "global" }), /无效/);
  assert.throws(() => readRuntimeConfig({ PORT: "0" }), /1–65535/);
  assert.throws(() => readRuntimeConfig({ PI_SESSION_MODE: "new" }), /PI_SESSION_MODE 无效/);
  assert.throws(() => readRuntimeConfig({ PI_SESSION_RECOVERY: "ignore" }), /PI_SESSION_RECOVERY 无效/);
  assert.throws(() => readRuntimeConfig({ PI_SESSION_DIR: "" }), /PI_SESSION_DIR 不能为空/);
  assert.throws(() => readRuntimeConfig({ PI_SESSION_DIR: ".pi-config" }), /必须是.*分离/);
  assert.throws(() => readRuntimeConfig({ PI_SESSION_DIR: "." }), /必须是.*分离/);
});
test("runtime configuration defaults to project-local persistent sessions", () => {
  const config = readRuntimeConfig({});
  assert.equal(config.sessionMode, "continue-recent");
  assert.equal(config.sessionRecovery, "fail");
  assert.match(config.sessionDir, /\.pi\/sessions$/);
});

test("runtime configuration supports memory mode, recovery fallback, and a custom session root", () => {
  const config = readRuntimeConfig({ PI_SESSION_MODE: "memory", PI_SESSION_RECOVERY: "new", PI_SESSION_DIR: "/tmp/pi-sessions" });
  assert.equal(config.sessionMode, "memory");
  assert.equal(config.sessionRecovery, "new");
  assert.equal(config.sessionDir, "/tmp/pi-sessions");
});
