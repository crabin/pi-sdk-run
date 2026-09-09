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
});
