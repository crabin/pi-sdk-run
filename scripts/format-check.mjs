import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const root = new URL("../", import.meta.url);
const excluded = new Set([".codegraph", ".git", ".pi-config", "dist", "node_modules"]);
const excludedFiles = new Set([".DS_Store", ".env"]);
const walk = (directory = root, prefix = "") => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const relative = `${prefix}${entry.name}`;
  if (entry.isDirectory()) return excluded.has(entry.name) ? [] : walk(new URL(`${entry.name}/`, directory), `${relative}/`);
  return entry.isFile() && !excludedFiles.has(entry.name) ? [relative] : [];
});
let files;
try {
  files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
} catch {
  files = walk();
}
const bad = [];
for (const file of files) {
  const text = readFileSync(new URL(file, root), "utf8");
  if (/\r|[ \t]+$/m.test(text) || (text.length > 0 && !text.endsWith("\n"))) bad.push(file);
}
if (bad.length) { console.error(`格式检查失败：${bad.join(", ")}`); process.exitCode = 1; }
