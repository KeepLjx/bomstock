// ============================================================================
// CSV 读写工具
// 用于「清洗后的 Excel -> CSV」中间格式，所有后续匹配操作基于 CSV 进行
// 实现 RFC 4180 风格的转义/解析
// ============================================================================

import fs from "node:fs";

/** 将单个字段按 RFC 4180 转义 */
function escapeField(value: string): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 写入 CSV（带 UTF-8 BOM，便于 Excel 直接打开中文） */
export function writeCSV(
  filePath: string,
  columns: string[],
  rows: string[][],
): void {
  const lines: string[] = [];
  lines.push(columns.map(escapeField).join(","));
  for (const row of rows) {
    const cells = columns.map((_, i) => escapeField(row[i] ?? ""));
    lines.push(cells.join(","));
  }
  // BOM + CRLF 行尾，最大化 Excel 兼容
  const content = "\uFEFF" + lines.join("\r\n");
  fs.writeFileSync(filePath, content, "utf8");
}

/**
 * 解析一行 CSV（处理引号、嵌入逗号、换行、转义双引号）
 * 返回字段数组及消耗的字符数
 */
function parseCSVLine(text: string, start: number): { fields: string[]; next: number } {
  const fields: string[] = [];
  let i = start;
  let field = "";
  let inQuotes = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i += 1;
      } else if (ch === ",") {
        fields.push(field);
        field = "";
        i += 1;
      } else if (ch === "\r") {
        // 行结束
        if (i + 1 < n && text[i + 1] === "\n") i += 1;
        i += 1;
        fields.push(field);
        return { fields, next: i };
      } else if (ch === "\n") {
        i += 1;
        fields.push(field);
        return { fields, next: i };
      } else {
        field += ch;
        i += 1;
      }
    }
  }
  fields.push(field);
  return { fields, next: n };
}

/** 清洗后的表格数据结构 */
export interface CleanedTable {
  /** 列名（有序，已剔除空列/纯色列） */
  columns: string[];
  /** 列名 -> 列索引（首个出现） */
  headerMap: Record<string, number>;
  /** 数据行，每行按 columns 对齐 */
  rows: string[][];
  /** 数据行数 */
  rowCount: number;
}

/** 读取 CSV 为 CleanedTable */
export function readCSV(filePath: string): CleanedTable {
  let text = fs.readFileSync(filePath, "utf8");
  // 去除 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const allRows: string[][] = [];
  let pos = 0;
  const n = text.length;
  while (pos < n) {
    // 跳过空行尾
    if (text[pos] === "\r" || text[pos] === "\n") {
      pos += 1;
      continue;
    }
    const { fields, next } = parseCSVLine(text, pos);
    allRows.push(fields);
    pos = next;
  }

  if (allRows.length === 0) {
    return { columns: [], headerMap: {}, rows: [], rowCount: 0 };
  }

  const columns = allRows[0].map((c) => c.trim());
  const headerMap: Record<string, number> = {};
  columns.forEach((c, i) => {
    if (c && headerMap[c] === undefined) headerMap[c] = i;
  });

  const rows = allRows.slice(1);
  return { columns, headerMap, rows, rowCount: rows.length };
}

/** 从表格取字符串值 */
export function tableStr(table: CleanedTable, row: string[], colName: string): string {
  const idx = table.headerMap[colName];
  if (idx === undefined) return "";
  return (row[idx] ?? "").trim();
}

/** 从表格取列索引 */
export function tableCol(table: CleanedTable, colName: string): number {
  return table.headerMap[colName] ?? -1;
}

/** 判断某行是否全空 */
export function isRowEmpty(row: string[]): boolean {
  return row.every((c) => (c ?? "").trim() === "");
}
