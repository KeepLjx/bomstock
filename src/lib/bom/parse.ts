import ExcelJS from "exceljs";
import path from "node:path";
import {
  YIBO_CODE_ALIASES,
  YIBO_STOCK_ALIASES,
  YIBO_PROBLEM_ALIASES,
  PART_STATUS_ALIASES,
  USAGE_ALIASES,
  BOM_CODE_ALIASES,
  QUANTITY_ALIASES,
  DEMAND_ALIASES,
  SUPPLY_ALIASES,
  INVENTORY_CODE_ALIASES,
  INVENTORY_QTY_ALIASES,
} from "./aliases";

/** 已知 BOM 关键列的别名集合 */
export {
  YIBO_CODE_ALIASES,
  YIBO_STOCK_ALIASES,
  YIBO_PROBLEM_ALIASES,
  PART_STATUS_ALIASES,
  USAGE_ALIASES,
  BOM_CODE_ALIASES,
  QUANTITY_ALIASES,
  SUPPLY_ALIASES,
  INVENTORY_CODE_ALIASES,
  INVENTORY_QTY_ALIASES,
};

/**
 * 规范化列名：去除首尾空格、换行、不可见字符、统一全角。
 * 关键：使用 valueToString 处理富文本/公式对象，
 * 否则带颜色格式的表头（如红字「一博问题」）会变成 "[object Object]"。
 */
export function normalizeHeader(raw: unknown): string {
  const s = valueToString(raw);
  return s.replace(/[\s\u3000\u00A0]+/g, "").trim();
}

/** 判断是否为 change log 类工作表（应忽略） */
export function isChangeLogSheet(name: string): boolean {
  if (!name) return false;
  const s = name.trim().toLowerCase().replace(/[\s_\-]+/g, "");
  const patterns = [
    "changelog",
    "log",
    "修改记录",
    "变更记录",
    "变更日志",
    "修改日志",
    "更新记录",
    "修订记录",
  ];
  // 精确匹配（去空白/分隔后）
  if (patterns.includes(s)) return true;
  // 包含 "changelog" 或 "change log"
  if (s.includes("changelog")) return true;
  // 末尾为 "log" 且长度较短（如 "Sheet1Log"）
  if (/log$/.test(s) && s.length <= 6) return true;
  return false;
}

/**
 * 单遍扫描工作表，同时确定：
 *  1. 含文本的「有意义列」（空列 / 仅含颜色标记的列被剔除）
 *  2. 实际数据末行 lastDataRow
 *
 * 性能关键点：
 *  - 使用 row.eachCell({ includeEmpty: false })，只遍历有值的单元格，
 *    跳过仅有边框/底色但无字符的「格式化空单元格」（真实文件常刷格式到数万行）。
 *  - 连续 EMPTY_RUN_LIMIT 行无文本即提前终止，避免扫描被格式撑大的虚高行数。
 */
const MAX_SCAN_ROWS = 100000;
const EMPTY_RUN_LIMIT = 80;

interface ScanResult {
  lastDataRow: number;
  meaningfulCols: number[];
}

export function scanWorksheet(
  worksheet: ExcelJS.Worksheet,
  headerRow: number,
): ScanResult {
  const meaningful = new Set<number>();
  let lastRow = headerRow;
  let emptyRun = 0;
  const cap = Math.min(worksheet.rowCount || 0, MAX_SCAN_ROWS);

  for (let r = headerRow; r <= cap; r++) {
    const row = worksheet.getRow(r);
    let hasText = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const s = cellToString(cell);
      if (s && s.trim() !== "") {
        hasText = true;
        meaningful.add(colNumber);
      }
    });
    if (hasText) {
      lastRow = r;
      emptyRun = 0;
    } else {
      emptyRun += 1;
      if (emptyRun >= EMPTY_RUN_LIMIT) break;
    }
  }

  return {
    lastDataRow: lastRow,
    meaningfulCols: [...meaningful].sort((a, b) => a - b),
  };
}

/** 加载工作表并分析结构（用于在原始 BOM 上就地修改） */
export interface PreparedSheet {
  workbook: import("exceljs").Workbook;
  worksheet: import("exceljs").Worksheet;
  sheets: string[];
  mainSheet: string;
  headerRow: number;
  /** 全部表头：列号(1-based) -> 列名（仅含有意义列） */
  headers: Record<number, string>;
  headerMap: Record<string, number>;
  meaningfulCols: number[];
  lastDataRow: number;
  hasYiboCode: boolean;
}

export async function prepareWorksheet(
  filePath: string,
  preferredSheet?: string,
): Promise<PreparedSheet> {
  const parsed = await parseExcelStructure(filePath, preferredSheet);
  const ws = parsed.worksheet;
  const headerRow = parsed.headerRow;
  const { lastDataRow, meaningfulCols } = scanWorksheet(ws, headerRow);

  const headers: Record<number, string> = {};
  const headerMap: Record<string, number> = {};
  for (const c of meaningfulCols) {
    const name = normalizeHeader(ws.getCell(headerRow, c).value);
    headers[c] = name;
    if (name && headerMap[name] === undefined) headerMap[name] = c;
  }
  const hasYiboCode = Object.values(headers).some((h) =>
    matchAlias(h, YIBO_CODE_ALIASES),
  );

  return {
    workbook: parsed.workbook,
    worksheet: ws,
    sheets: parsed.sheets,
    mainSheet: parsed.mainSheet,
    headerRow,
    headers,
    headerMap,
    meaningfulCols,
    lastDataRow,
    hasYiboCode,
  };
}

/** 在别名集合中匹配列名（精确 + 包含） */
export function matchAlias(header: string, aliases: string[]): boolean {
  if (!header) return false;
  const h = normalizeHeader(header);
  if (h === "") return false;
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (a === "") continue;
    if (h === a) return true;
    // 处理 "一博物料编码.1" 这类后缀
    if (h.startsWith(a) && /\.\d+$/.test(h.slice(a.length))) return true;
    // 完全包含（针对带括号等修饰）
    if (h.includes(a) && a.length >= 3) return true;
  }
  return false;
}

/** 从别名集合中查找匹配的表头列 */
export function findHeaderColumn(
  headerMap: Record<string, number>,
  aliases: string[],
): string | undefined {
  // 先精确匹配
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (a && headerMap[a] !== undefined) return a;
  }
  // 再用 matchAlias
  for (const header of Object.keys(headerMap)) {
    if (matchAlias(header, aliases)) return header;
  }
  return undefined;
}

/**
 * 读取工作簿并解析主工作表结构。
 * 自动探测表头行：在头 12 行中，找到包含最多「已知列名」的那一行。
 */
export async function parseExcelStructure(
  filePath: string,
  preferredSheet?: string,
  knownAliases?: string[][],
): Promise<{
  workbook: ExcelJS.Workbook;
  worksheet: ExcelJS.Worksheet;
  sheets: string[];
  mainSheet: string;
  rowCount: number;
  headerRow: number;
  headers: Record<number, string>;
  headerMap: Record<string, number>;
  hasYiboCode: boolean;
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets = workbook.worksheets.map((ws) => ws.name);
  if (sheets.length === 0) {
    throw new Error("工作簿中未找到任何工作表");
  }

  // 忽略 change log 类工作表
  const usableSheets = sheets.filter((s) => !isChangeLogSheet(s));
  const candidateSheets = usableSheets.length > 0 ? usableSheets : sheets;

  let mainSheet =
    preferredSheet && candidateSheets.includes(preferredSheet)
      ? preferredSheet
      : candidateSheets[0];
  const worksheet = workbook.getWorksheet(mainSheet);
  if (!worksheet) {
    throw new Error(`工作表 ${mainSheet} 不存在`);
  }

  // 探测表头行
  const allAliases = knownAliases ?? [
    YIBO_CODE_ALIASES,
    USAGE_ALIASES,
    BOM_CODE_ALIASES,
    QUANTITY_ALIASES,
    DEMAND_ALIASES,
    YIBO_STOCK_ALIASES,
    YIBO_PROBLEM_ALIASES,
    INVENTORY_CODE_ALIASES,
    INVENTORY_QTY_ALIASES,
  ];

  const scanRows = Math.min(worksheet.rowCount, 12);
  let bestRow = 1;
  let bestScore = -1;
  for (let r = 1; r <= scanRows; r++) {
    const row = worksheet.getRow(r);
    let score = 0;
    const colSet = new Set<string>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const h = normalizeHeader(cell.value);
      if (!h) return;
      colSet.add(h);
    });
    for (const aliasGroup of allAliases) {
      for (const h of colSet) {
        if (matchAlias(h, aliasGroup)) {
          score += 1;
          break;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  const headerRow = bestRow;
  const headers: Record<number, string> = {};
  const headerMap: Record<string, number> = {};
  const headerRowObj = worksheet.getRow(headerRow);
  headerRowObj.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const h = normalizeHeader(cell.value);
    if (!h) return;
    headers[colNumber] = h;
    // 第一个出现的列名占据该列索引
    if (headerMap[h] === undefined) headerMap[h] = colNumber;
  });

  const hasYiboCode = Object.values(headers).some((h) =>
    matchAlias(h, YIBO_CODE_ALIASES),
  );

  const rowCount = worksheet.rowCount;

  return {
    workbook,
    worksheet,
    sheets,
    mainSheet,
    rowCount,
    headerRow,
    headers,
    headerMap,
    hasYiboCode,
  };
}

/**
 * 将任意单元格「原始值」转为字符串。
 * 处理：富文本（带颜色/样式的文本会变成 {richText:[...]} 对象）、
 *       公式对象（{formula,result}）、超链接对象等，避免出现 "[object Object]"。
 */
export function valueToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    // 富文本（如红字表头、带样式单元格）
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: unknown }>)
        .map((t) => (t.text === null || t.text === undefined ? "" : String(t.text)))
        .join("")
        .trim();
    }
    // 公式对象
    if ("result" in obj) {
      const r = obj.result;
      if (r === null || r === undefined) return "";
      if (typeof r === "number") return String(r);
      return String(r).trim();
    }
    // 超链接 / 文本对象
    if (typeof obj.text === "string") return obj.text.trim();
    if ("text" in obj) return String(obj.text).trim();
    if ("sharedFormula" in obj) return "";
  }
  return String(v).trim();
}

/** 将单元格值读取为字符串（处理公式缓存值、富文本等） */
export function cellToString(cell: ExcelJS.Cell): string {
  return valueToString(cell.value);
}

/** 将单元格值读取为数字（处理公式缓存值、字符串数字、含单位的文本） */
export function cellToNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") {
    if ("result" in v) {
      const r = (v as { result: unknown }).result;
      if (typeof r === "number") return isNaN(r) ? null : r;
      if (typeof r === "string") return parseLooseNumber(r);
      return null;
    }
  }
  if (typeof v === "string") return parseLooseNumber(v);
  return null;
}

/** 宽松数字解析：去除千分位、单位、空格 */
export function parseLooseNumber(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,，\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/** 工作表从某一行开始到最后一行的有效数据行号列表（跳过完全空行） */
export function dataRowNumbers(
  worksheet: ExcelJS.Worksheet,
  headerRow: number,
): number[] {
  const rows: number[] = [];
  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const s = cellToString(cell);
      if (s !== "") hasValue = true;
    });
    if (hasValue) rows.push(r);
  }
  return rows;
}

/** 推测文件类别 */
export function detectFileKind(
  originalName: string,
  headers: Record<number, string>,
): "bom" | "inventory" | "bills" | "transfer" {
  const name = originalName.toLowerCase();
  if (name.includes("物料库存") || name.includes("库存查询") || name.includes("inventory")) {
    return "inventory";
  }
  if (name.includes("单据") || name.includes("bills")) {
    return "bills";
  }
  if (name.includes("调拨") || name.includes("齐套") || name.includes("工单") || name.includes("transfer")) {
    return "transfer";
  }
  // 根据列内容判断
  const headerStr = Object.values(headers).join("|");
  if (headerStr.includes("成品名称") && headerStr.includes("计划数量")) {
    return "transfer";
  }
  if (headerStr.includes("物料编码") && (headerStr.includes("总数量") || headerStr.includes("现存数量"))) {
    return "inventory";
  }
  // 默认 BOM
  return "bom";
}

/** 推测 BOM 角色 */
export function detectBomRole(originalName: string): "target" | "occupied" {
  const name = originalName.toUpperCase();
  if (
    name.includes("复投") ||
    name.includes("REWORK") ||
    name.includes("重工") ||
    name.includes("二次") ||
    name.includes("Rework")
  ) {
    return "occupied";
  }
  return "target";
}

/** 安全的文件扩展名 */
export function safeExt(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return ext === ".xlsm" ? ".xlsx" : ext || ".xlsx";
}

/**
 * 从 BOM 文件名/表名中提取产品名称。
 * 例：
 *   S801PE1600DEBUG_BOM_1V1 → S801PE1600
 *   S801CPR20260305         → S801CPR
 *   S801XHC32PA_V2_0        → S801XHC32PA
 *   S801XHC32PA BOM         → S801XHC32PA
 *
 * 规则：去除扩展名 → 去除已知后缀(_BOM/DEBUG/REWORK/_V*等) → 去除末尾日期(8位连续数字)
 */
export function extractProductName(rawName: string): string {
  let s = rawName.replace(/\.(xlsx|xlsm|xls)$/i, "").toUpperCase().trim();
  // 去除已知后缀关键词（顺序重要）
  s = s.replace(/_BOM.*$/i, ""); // _BOM 及之后
  s = s.replace(/DEBUG.*$/i, ""); // DEBUG 及之后
  s = s.replace(/REWORK.*$/i, ""); // REWORK 及之后
  s = s.replace(/_V[\d._]+$/i, ""); // _V2_0 等版本后缀
  s = s.replace(/\s*BOM\s*$/i, ""); // 末尾 BOM
  s = s.replace(/_1V\d+$/i, ""); // _1V1 等版本
  // 去除末尾 8 位日期（如 20260305、20260128）
  s = s.replace(/(\d{2})?(\d{6})$/, (match) => {
    // 仅当看起来像日期（20XX 开头的 8 位数字）时去除
    return /^\d{8}$/.test(match) && match.startsWith("20") ? "" : match;
  });
  // 再次清理尾部
  s = s.replace(/[_\s]+$/, "").trim();
  // 兜底：如果结果不以字母开头（极端情况），返回原文件名去后缀
  if (!s || s.length < 3) {
    return rawName.replace(/\.(xlsx|xlsm|xls)$/i, "").toUpperCase().trim();
  }
  return s;
}

/** 清洗后文件的元数据 */
export interface CleanedFileMeta {
  /** 生成的 CSV 文件名（位于任务目录内） */
  csvName: string;
  /** 有意义列：原始列号(1-based) -> 列名 */
  columns: Record<number, string>;
  /** 列名 -> 原始列号 */
  headerMap: Record<string, number>;
  /** 有意义列数量 */
  columnCount: number;
  /** 被剔除的无意义列数 */
  removedColumnCount: number;
  /** 工作簿所有 sheet */
  sheets: string[];
  /** 选中的主 sheet（已忽略 change log） */
  mainSheet: string;
  /** 表头行号 */
  headerRow: number;
  /** 数据行数 */
  rowCount: number;
  /** 是否含一博物料编码列 */
  hasYiboCode: boolean;
  /** 是否忽略了 change log sheet */
  ignoredChangeLog: string[];
}

/**
 * 清洗 Excel -> CSV：
 * 1. 忽略 change log 工作表
 * 2. 剔除空列 / 仅含颜色标记无字符的无意义列
 * 3. 导出为 CSV（带 BOM），供后续匹配操作使用
 */
export async function cleanExcelToCSV(
  filePath: string,
  csvPath: string,
  preferredSheet?: string,
): Promise<CleanedFileMeta> {
  const { writeCSV } = await import("./csv");
  const parsed = await parseExcelStructure(filePath, preferredSheet);
  const ws = parsed.worksheet;
  const headerRow = parsed.headerRow;

  // 计算表头行覆盖的最大列（用于统计被剔除列数）
  let maxCol = ws.columnCount || 0;
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (_c, colNumber) => {
    if (colNumber > maxCol) maxCol = colNumber;
  });

  // 单遍扫描：同时得到有意义列 + 数据末行（高效，跳过格式化空单元格）
  const { lastDataRow, meaningfulCols } = scanWorksheet(ws, headerRow);

  const columns: Record<number, string> = {};
  const headerMap: Record<string, number> = {};
  for (const c of meaningfulCols) {
    const name = normalizeHeader(ws.getCell(headerRow, c).value);
    columns[c] = name;
    if (name && headerMap[name] === undefined) headerMap[name] = c;
  }
  if (meaningfulCols.length === 0) {
    throw new Error("工作表中未找到任何有效数据列（全部为空列或仅含颜色标记）");
  }

  const removedColumnCount = Math.max(0, maxCol - meaningfulCols.length);

  // 提取数据矩阵（表头 + 数据行），跳过完全空行
  const colNames = meaningfulCols.map((c) => columns[c] || `列${c}`);
  const dataRows: string[][] = [];
  for (let r = headerRow + 1; r <= lastDataRow; r++) {
    const row = ws.getRow(r);
    const out: string[] = meaningfulCols.map((c) => cellToString(row.getCell(c)));
    if (out.every((s) => s.trim() === "")) continue; // 跳过空行
    dataRows.push(out);
  }

  writeCSV(csvPath, colNames, dataRows);

  const allSheets = parsed.sheets;
  const ignoredChangeLog = allSheets.filter((s) => isChangeLogSheet(s));

  return {
    csvName: "",
    columns,
    headerMap,
    columnCount: meaningfulCols.length,
    removedColumnCount,
    sheets: allSheets,
    mainSheet: parsed.mainSheet,
    headerRow,
    rowCount: dataRows.length,
    hasYiboCode: parsed.hasYiboCode,
    ignoredChangeLog,
  };
}

/**
 * 从已生成的 CSV + 表头中检测「生产套数」。
 * 用于「已占用 BOM」自动读取套数并默认填入：
 *  1. 表头中嵌入套数，如「总需求数（5套）」「需求数量(3套)」→ 提取数字
 *  2. 存在「套数 / 计划数量 / 生产套数」列 → 取首个数值
 *  3. 其余返回 null
 */
export async function detectSetsFromCSV(
  csvPath: string,
  headers: Record<number, string>,
): Promise<number | null> {
  // 1) 表头嵌入套数
  for (const name of Object.values(headers)) {
    if (!name) continue;
    const m = name.match(/(\d+)\s*套/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0) return n;
    }
  }
  // 2) 套数列 -> 首个数值
  const { readCSV } = await import("./csv");
  if (!readCSV) return null;
  const fs = await import("node:fs");
  if (!fs.existsSync(csvPath)) return null;
  const table = readCSV(csvPath);
  const setsCol = findHeaderColumn(table.headerMap, [
    "套数",
    "计划数量",
    "计划套数",
    "生产套数",
    "ProductionSets",
    "Sets",
  ]);
  if (setsCol) {
    const idx = table.headerMap[setsCol];
    for (const row of table.rows) {
      const v = parseLooseNumber(row[idx]);
      if (v !== null && v > 0) return v;
    }
  }
  return null;
}
