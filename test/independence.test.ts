import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isMainModule, projectRoot } from "../src/paths.js";

test("entry detection works with absolute paths outside the current cwd", () => {
  assert.equal(isMainModule("file:///tmp/example.js", "/tmp/example.js"), true);
  assert.equal(isMainModule("file:///tmp/example.js", "/tmp/other.js"), false);
});

test("entry detection survives the macOS /tmp symlink", () => {
  assert.equal(isMainModule(new URL(import.meta.url).href, new URL(import.meta.url).pathname), true);
});

test("compiled modules locate project resources from an unrelated cwd", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `import('${projectRoot}/dist/src/paths.js').then(m=>console.log(m.projectRoot))`], { cwd: "/tmp", encoding: "utf8" }).trim();
  assert.equal(output, projectRoot);
});

test("runtime source and scripts have no tutorial or cwd resource dependencies", () => {
  const files = execFileSync("find", [`${projectRoot}/src`, `${projectRoot}/test`], { encoding: "utf8" }).trim().split("\n").filter((file) => /\.(ts|js)$/.test(file));
  const packageJson = readFileSync(`${projectRoot}/package.json`, "utf8");
  const parentPattern = new RegExp(["pi_sdk", "learn"].join("_") + "|\\.\\.\\/shared");
  const cwdPattern = new RegExp(["process", "cwd\\(\\)"].join("\\.") + ".*(data|skills|public)");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, parentPattern);
    assert.doesNotMatch(source, cwdPattern);
  }
  assert.doesNotMatch(packageJson, parentPattern);
});
