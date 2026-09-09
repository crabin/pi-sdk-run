import assert from "node:assert/strict";
import { chdir, cwd } from "node:process";
import test from "node:test";
import { formatQueryResult, loadSales, parseCsv, queryRows, querySales, salesDataPath } from "../src/tools/query-data.js";

test("bundled sales fixture is stable and independent of cwd", () => {
  const before = cwd();
  try {
    chdir("/tmp");
    const { headers, rows } = loadSales();
    assert.equal(rows.length, 12);
    assert.deepEqual(headers, ["日期", "产品", "地区", "销售额", "数量", "销售人员"]);
    assert.match(salesDataPath, /pi-sdk-run\/data\/sales\.csv$/);
  } finally { chdir(before); }
});

test("CSV parsing, query and formatting are independently injectable", () => {
  const table = parseCsv("name,amount\na,10\nb,20\n");
  const rows = queryRows(table, "amount", ">", "10");
  assert.equal(rows.length, 1); assert.match(formatQueryResult(table, rows, "amount", ">", "10", 1), /b, 20/);
  assert.deepEqual(parseCsv(""), { headers: [], rows: [] });
  assert.throws(() => parseCsv("a,a\n1,2"), /重复/);
  assert.equal(querySales("地区", "=", "华东", -1).isError, true);
});

test("query_data preserves operators, errors and truncation", () => {
  assert.match(querySales("地区", "=", "华东").content[0]!.text, /匹配 4\/12 行/);
  assert.match(querySales("产品", "contains", "笔记本").content[0]!.text, /匹配 4\/12 行/);
  assert.match(querySales("销售额", ">", "40000").content[0]!.text, /匹配 4\/12 行/);
  assert.match(querySales("销售额", "<", "10000").content[0]!.text, /匹配 1\/12 行/);
  assert.match(querySales("数量", ">=", "20").content[0]!.text, /匹配 4\/12 行/);
  assert.match(querySales("数量", "<=", "8").content[0]!.text, /匹配 2\/12 行/);
  assert.match(querySales("产品", ">", "1").content[0]!.text, /匹配 0\/12 行/);
  const invalid = querySales("坏列", "=", "x");
  assert.equal(invalid.isError, true);
  assert.equal(invalid.content[0]!.text, '列名 "坏列" 不存在。可用列：日期、产品、地区、销售额、数量、销售人员');
  assert.match(querySales("地区", "!=", "不存在", 2).content[0]!.text, /\.\.\. 还有 10 行未显示/);
});
