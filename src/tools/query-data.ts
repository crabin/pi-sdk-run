import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { dataDirectory } from "../paths.js";

export const salesDataPath = resolve(dataDirectory, "sales.csv");

export interface DataTable { headers: string[]; rows: Record<string, string>[] }
export type QueryOperator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains";
export function parseCsv(content: string): DataTable {
  const lines = content.trim().split(/\r?\n/);
  const headers = (lines[0] ?? "").split(",").map((value) => value.trim());
  if (headers.length === 1 && headers[0] === "") return { headers: [], rows: [] };
  if (new Set(headers).size !== headers.length) throw new Error("CSV 表头不能重复");
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
  return { headers, rows };
}
export function loadSales(): DataTable { return parseCsv(readFileSync(salesDataPath, "utf8")); }

export function queryRows(table: DataTable, column: string, operator: QueryOperator, value: string): Record<string, string>[] {
  if (!table.headers.includes(column)) throw new Error(`列名 "${column}" 不存在。可用列：${table.headers.join("、")}`);
  return table.rows.filter((row) => {
    const cell = row[column]; if (cell === undefined) return false;
    const left = Number(cell), right = Number(value), numeric = Number.isFinite(left) && Number.isFinite(right);
    switch (operator) { case "=": return cell === value; case "!=": return cell !== value; case ">": return numeric && left > right; case "<": return numeric && left < right; case ">=": return numeric && left >= right; case "<=": return numeric && left <= right; case "contains": return cell.includes(value); }
  });
}
export function formatQueryResult(table: DataTable, filtered: Record<string, string>[], column: string, operator: QueryOperator, value: string, limit: number): string {
  let text = `查询条件：${column} ${operator} ${value}\n匹配 ${filtered.length}/${table.rows.length} 行\n\n${table.headers.join(", ")}\n`;
  for (const row of filtered.slice(0, limit)) text += `${table.headers.map((header) => row[header]).join(", ")}\n`;
  if (filtered.length > limit) text += `\n... 还有 ${filtered.length - limit} 行未显示`; return text;
}

export function querySales(column: string, operator: QueryOperator, value: string, limit = 20) {
  const table = loadSales();
  if (!Number.isInteger(limit) || limit < 0) return { content: [{ type: "text" as const, text: "limit 必须是非负整数" }], details: {}, isError: true };
  try { const filtered = queryRows(table, column, operator, value); return { content: [{ type: "text" as const, text: formatQueryResult(table, filtered, column, operator, value, limit) }], details: {} }; }
  catch (error) { return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "查询失败" }], details: {}, isError: true }; }
}

export const queryDataTool = defineTool({
  name: "query_data",
  label: "查询销售数据",
  description: "查询销售数据（sales.csv）。按指定列的条件过滤，返回匹配的行。字段：日期、产品、地区、销售额、数量、销售人员。",
  parameters: Type.Object({
    column: Type.String(),
    operator: Type.Union([Type.Literal("="), Type.Literal("!="), Type.Literal(">"), Type.Literal("<"), Type.Literal(">="), Type.Literal("<="), Type.Literal("contains")]),
    value: Type.String(),
    limit: Type.Optional(Type.Number()),
  }),
  async execute(_id, params) { return querySales(params.column, params.operator, params.value, params.limit); },
});
