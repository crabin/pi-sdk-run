import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { createProjectResourceLoader, validateProjectSkills } from "../src/agent/index.js";
import { salesAgentDefinition } from "../src/agent/sales-agent.js";
import { projectRoot, targetSkillDirectory } from "../src/paths.js";
import type { ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";

test("project-only resource loader discovers only declared project skills from any cwd", async () => {
  const original = process.cwd();
  try {
    process.chdir("/tmp");
    const loader = await createProjectResourceLoader(salesAgentDefinition);
    const { skills, diagnostics } = loader.getSkills();
    const projectSkill = skills.find((skill) => skill.name === "dg-piagent");
    assert.ok(projectSkill);
    assert.equal(await realpath(projectSkill.filePath), await realpath(`${targetSkillDirectory}/SKILL.md`));
    assert.deepEqual(skills.map((skill) => skill.name), ["agent-reach", "dg-piagent"]);
    assert.ok(skills.every((skill) => skill.filePath.startsWith(`${projectRoot}/skills/`)));
    assert.equal(diagnostics.some((diagnostic) => diagnostic.type === "collision"), false);
    assert.equal(diagnostics.some((diagnostic) => diagnostic.type === "error"), false);
  } finally { process.chdir(original); }
});

test("skill diagnostics follow the fixed fatal/non-fatal policy", async () => {
  const loader = await createProjectResourceLoader(salesAgentDefinition);
  const skill = loader.getSkills().skills.find((item) => item.name === "dg-piagent")!;
  const messages: string[] = [];
  const logger = { info() {}, warn(message: string) { messages.push(message); }, error(message: string) { messages.push(message); } };
  const unrelated: ResourceDiagnostic = { type: "warning", message: "other", path: "/tmp/other-skill/SKILL.md" };
  await validateProjectSkills([skill], [unrelated], `${targetSkillDirectory}/SKILL.md`, logger);
  assert.equal(messages.length, 1);
  for (const diagnostic of [
    { type: "warning", message: "target warning", path: `${targetSkillDirectory}/SKILL.md` },
    { type: "error", message: "parse failed" },
    { type: "collision", message: "duplicate" },
  ] satisfies ResourceDiagnostic[]) {
    await assert.rejects(validateProjectSkills([skill], [diagnostic], `${targetSkillDirectory}/SKILL.md`, logger), /诊断失败/);
  }
  await assert.rejects(validateProjectSkills([], [], `${targetSkillDirectory}/SKILL.md`, logger), /必须加载/);
  await assert.rejects(validateProjectSkills([{ ...skill, description: "" }], [], `${targetSkillDirectory}/SKILL.md`, logger), /description/);
  await assert.rejects(validateProjectSkills([{ ...skill, filePath: `${projectRoot}/README.md` } as Skill], [], `${targetSkillDirectory}/SKILL.md`, logger), /来源不在/);
});

test("all real local Markdown navigation links resolve", async () => {
  const files = execFileSync("find", [targetSkillDirectory, "-type", "f", "-name", "*.md"], { encoding: "utf8" }).trim().split("\n");
  const broken: string[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      const link = match[1]!;
      if (/^(https?:|mailto:|#|<)/.test(link)) continue;
      if (!existsSync(resolve(dirname(file), decodeURIComponent(link)))) broken.push(`${file}: ${link}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("initial source manifest plus recorded changes explains the current skill copy", async () => {
  const manifestText = await readFile(`${projectRoot}/docs/skill-migration/source-manifest.sha256`, "utf8");
  const initial = new Map(manifestText.trim().split("\n").map((line) => {
    const match = /^(\w+)\s+.*skills\/dg-piagent\/(.+)$/.exec(line);
    assert.ok(match, `invalid manifest line: ${line}`);
    return [match[2]!, match[1]!] as const;
  }));
  assert.equal(initial.size, 63);
  const record = JSON.parse(await readFile(`${projectRoot}/docs/skill-migration/changes.json`, "utf8")) as { changes: Array<{ path: string; kind: string }> };
  const changed = new Set(record.changes.map((item) => item.path));
  const currentFiles = execFileSync("find", [targetSkillDirectory, "-type", "f"], { encoding: "utf8" }).trim().split("\n");
  for (const file of currentFiles) {
    const relativePath = file.slice(targetSkillDirectory.length + 1);
    if (changed.has(relativePath)) continue;
    const digest = createHash("sha256").update(await readFile(file)).digest("hex");
    assert.equal(digest, initial.get(relativePath), relativePath);
  }
  for (const [path] of initial) assert.ok(existsSync(`${targetSkillDirectory}/${path}`), path);
  for (const path of changed) assert.ok(existsSync(`${targetSkillDirectory}/${path}`), path);
});
