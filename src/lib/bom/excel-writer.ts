// ============================================================================
// Excel 写入器
// 在原始目标 BOM 上就地插入列、保留公式/样式/空列/合并单元格、应用高亮
// ============================================================================

import ExcelJS from "exceljs";
import type { MaterialResult, HighlightColor } from "./types";
import type { OutputColumn, CellData, TableData } from "./types";
import { HIGHLIGHT_CSS } from "./types";

// ---------- 列号 <-> 字母 ----------
export function colNameToNum(name: string): number {
  let n = 0;
  const s = name.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n;
}

export function numToColName(num: number): string {
  let n = num;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseRange(range: string): {
  top: number;
  left: number;
  bottom: number;
  right: number;
} | null {
  const m = range.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) return null;
  const left = colNameToNum(m[1]);
  const top = parseInt(m[2], 10);
  if (m[3] && m[4]) {
    return {
      top,
      left,
      bottom: parseInt(m[4], 10),
      right: colNameToNum(m[3]),
    };
  }
  return { top, left, bottom: top, right: left };
}

function rangeToString(r: {
  top: number;
  left: number;
  bottom: number;
  right: number;
}): string {
  return `${numToColName(r.left)}${r.top}:${numToColName(r.right)}${r.bottom}`;
}

function cloneStyle(style: unknown): Record<string, unknown> {
  if (!style || typeof style !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(style));
  } catch {
    return {};
  }
}

function getMerges(ws: ExcelJS.Worksheet): string[] {
  const model = (ws as unknown as { model?: { merges?: unknown } }).model;
  const merges = model?.merges;
  if (Array.isArray(merges)) return merges.map((m) => String(m));
  if (merges && typeof merges === "object") {
    return Object.keys(merges as Record<string, unknown>);
  }
  const internal = (ws as unknown as { _merges?: Map<string, unknown> })._merges;
  if (internal instanceof Map) return Array.from(internal.keys());
  return [];
}

function cloneCellValue(v: ExcelJS.CellValue): ExcelJS.CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return JSON.parse(JSON.stringify(v));
  return v;
}

/**
 * 在 firstShiftCol 处插入 numNewCols 个空列，原 firstShiftCol 及之后的列整体右移。
 * 处理：单元格值、样式、公式引用偏移、合并区域、列宽。
 */
export function insertColumnsRight(
  ws: ExcelJS.Worksheet,
  firstShiftCol: number,
  numNewCols: number,
  headerRow: number,
): void {
  const maxRow = Math.max(ws.rowCount || 0, ws.actualRowCount || 0, headerRow);
  let maxCol = ws.columnCount || 0;
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: true }, (_c, colNumber) => {
      if (colNumber > maxCol) maxCol = colNumber;
    });
  }
  if (maxCol < firstShiftCol) maxCol = firstShiftCol;

  const merges = getMerges(ws);
  for (const rangeStr of merges) {
    const r = parseRange(rangeStr);
    if (!r) continue;
    try {
      ws.unMergeCells(rangeStr);
    } catch {
      /* ignore */
    }
  }

  for (let col = maxCol; col >= firstShiftCol; col--) {
    for (let row = 1; row <= maxRow; row++) {
      const src = ws.getCell(row, col);
      const dst = ws.getCell(row, col + numNewCols);
      const v = src.value;
      if (v !== null && v !== undefined) {
        if (
          v &&
          typeof v === "object" &&
          "formula" in v &&
          typeof (v as { formula: unknown }).formula === "string"
        ) {
          const fv = v as { formula: string; result?: unknown };
          dst.value = {
            formula: shiftFormula(fv.formula, firstShiftCol, numNewCols),
            result: fv.result,
          } as ExcelJS.CellValue;
        } else {
          dst.value = cloneCellValue(v);
        }
      } else {
        dst.value = null;
      }
      dst.style = cloneStyle(src.style) as unknown as ExcelJS.Style;
      src.value = null;
    }
    const width = ws.getColumn(col).width;
    if (width !== undefined) ws.getColumn(col + numNewCols).width = width;
  }

  for (const rangeStr of merges) {
    const r = parseRange(rangeStr);
    if (!r) continue;
    const newRange = shiftRange(r, firstShiftCol, numNewCols);
    try {
      ws.mergeCells(rangeToString(newRange));
    } catch {
      /* ignore */
    }
  }
}

function shiftRange(
  r: { top: number; left: number; bottom: number; right: number },
  firstShiftCol: number,
  numNewCols: number,
): { top: number; left: number; bottom: number; right: number } {
  if (r.right < firstShiftCol) return { ...r };
  if (r.left >= firstShiftCol) {
    return {
      top: r.top,
      left: r.left + numNewCols,
      bottom: r.bottom,
      right: r.right + numNewCols,
    };
  }
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right + numNewCols };
}

export function shiftFormula(
  formula: string,
  firstShiftCol: number,
  numNewCols: number,
): string {
  return formula.replace(
    /(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
    (match, dollar1, col, dollar2, rowNum) => {
      const colNum = colNameToNum(col);
      if (colNum >= firstShiftCol) {
        return dollar1 + numToColName(colNum + numNewCols) + dollar2 + rowNum;
      }
      return match;
    },
  );
}

// ---------- 颜色样式 ----------
const COLORS = {
  blue: { fill: "FF4472C4", font: "FFFFFFFF" },
  green: { fill: "FF00B050", font: "FFFFFFFF" },
  red: { fill: "FFFFC7CE", font: "FF9C0006" },
};

function applyHighlight(cell: ExcelJS.Cell, color: HighlightColor): void {
  if (color === "none") return;
  const c = COLORS[color];
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.fill } };
  cell.font = { ...(cell.font || {}), color: { argb: c.font }, bold: true };
}

export interface NewColumnDef {
  name: string;
  width?: number;
}

export const PHASE1_COLUMNS: NewColumnDef[] = [
  { name: "需求数量(N套)", width: 14 },
  { name: "库存总数量", width: 12 },
  { name: "扣减用量", width: 10 },
  { name: "可用库存", width: 10 },
  { name: "供料方式", width: 14 },
  { name: "库存状态", width: 28 },
];

export const ANALYSIS_COL_NAMES = PHASE1_COLUMNS.map((c) => c.name);
export const JZD_HEADER = "JZD确认";

/** 为新插入的列写入表头（复制锚点表头样式） */
function writeColumnHeaders(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  startCol: number,
  columns: NewColumnDef[],
  styleSourceCol: number,
): void {
  const refHeader = ws.getCell(headerRow, styleSourceCol);
  const refStyle = cloneStyle(refHeader.style);
  columns.forEach((col, idx) => {
    const cell = ws.getCell(headerRow, startCol + idx);
    cell.value = col.name;
    try {
      cell.style = { ...refStyle } as unknown as ExcelJS.Style;
    } catch {
      /* ignore */
    }
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.font = { ...(cell.font || {}), bold: true };
    if (col.width) ws.getColumn(startCol + idx).width = col.width;
  });
}

// ---------- 颜色转换 ----------
export function cssToArgb(css: string): string {
  return "FF" + css.replace("#", "").toUpperCase();
}
function argbColor(css: string): { argb: string } {
  return { argb: cssToArgb(css) };
}

// ---------- 分析列值与样式 ----------
function analysisStr(name: string, r: MaterialResult): string {
  switch (name) {
    case "需求数量(N套)":
      return String(r.demand ?? "");
    case "库存总数量":
      return r.totalStock === null || r.totalStock === undefined ? "" : String(r.totalStock);
    case "扣减用量":
      return String(r.deduction ?? 0);
    case "可用库存":
      return r.availableStock === null || r.availableStock === undefined ? "" : String(r.availableStock);
    case "供料方式":
      return r.supply;
    case "库存状态":
      return r.status;
    default:
      return "";
  }
}

function analysisCellStyle(
  name: string,
  hl: HighlightColor,
): { bc?: string; fc?: string } {
  if (hl === "blue" || hl === "red") return { ...HIGHLIGHT_CSS[hl] };
  if (hl === "green" && (name === "供料方式" || name === "库存状态")) {
    return { ...HIGHLIGHT_CSS.green };
  }
  return {};
}

function bakeAnalysisCells(r: MaterialResult): CellData[] {
  return ANALYSIS_COL_NAMES.map((name) => ({
    v: analysisStr(name, r),
    ...analysisCellStyle(name, r.highlight),
  }));
}

/** 将字符串还原为合适的单元格值（数字保持为数字） */
function toCellValue(raw: string): ExcelJS.CellValue {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  if (cleaned !== "" && !isNaN(n) && /^-?\d+(\.\d+)?$/.test(cleaned)) return n;
  return s;
}

// ============================================================================
// 在「原始目标 BOM」上就地修改（保留原样式/空列/合并单元格/公式）
// ============================================================================
export interface ModifyOptions {
  worksheet: ExcelJS.Worksheet;
  headerRow: number;
  meaningfulCols: number[];
  dataRows: { xlsxRow: number; cells: string[]; result?: MaterialResult }[];
  quantityCol: number;
  yiboProblemCol: number;
  runPhase2: boolean;
  colNames: string[];
}

export function modifyOriginalBom(opts: ModifyOptions): TableData {
  const ws = opts.worksheet;
  const headerRow = opts.headerRow;
  const { quantityCol, yiboProblemCol, meaningfulCols, colNames } = opts;

  // 1) Quantity 后插入 6 列
  const insertAt = quantityCol + 1;
  insertColumnsRight(ws, insertAt, 6, headerRow);
  writeColumnHeaders(ws, headerRow, insertAt, PHASE1_COLUMNS, quantityCol);

  // 2) 一博问题列后移后，在其后插入 JZD确认
  const shiftedYiboProblem =
    yiboProblemCol > 0
      ? yiboProblemCol > quantityCol
        ? yiboProblemCol + 6
        : yiboProblemCol
      : -1;
  let jzdColXlsx = -1;
  if (shiftedYiboProblem > 0) {
    const jzdInsertAt = shiftedYiboProblem + 1;
    insertColumnsRight(ws, jzdInsertAt, 1, headerRow);
    jzdColXlsx = jzdInsertAt;
    const refHeader = ws.getCell(headerRow, shiftedYiboProblem);
    const jzdCell = ws.getCell(headerRow, jzdColXlsx);
    jzdCell.value = JZD_HEADER;
    jzdCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    jzdCell.font = { ...(refHeader.font || {}), bold: true };
    try {
      jzdCell.style = cloneStyle(refHeader.style) as unknown as ExcelJS.Style;
    } catch {
      /* ignore */
    }
  }
  const jzdAt = jzdColXlsx;

  const origFinalPos = (c: number): number => {
    let p = c;
    if (c > quantityCol) p += 6;
    if (jzdAt > 0 && p >= jzdAt) p += 1;
    return p;
  };
  const analysisFinalPos = (k: number): number => {
    let p = quantityCol + 1 + k;
    if (jzdAt > 0 && p >= jzdAt) p += 1;
    return p;
  };

  // 3) 显示列布局 + 导出映射
  const columns: OutputColumn[] = [];
  const displayToXlsxCol: number[] = [];
  const supplyDispIdx = ANALYSIS_COL_NAMES.indexOf("供料方式");
  const statusDispIdx = ANALYSIS_COL_NAMES.indexOf("库存状态");
  let supplyCol = -1;
  let statusCol = -1;
  let yiboProblemDisp = -1;
  let jzdDisp = -1;

  meaningfulCols.forEach((mc, mi) => {
    columns.push({ kind: "orig", name: colNames[mi] || `列${mc}` });
    displayToXlsxCol.push(origFinalPos(mc));
    if (mc === yiboProblemCol) yiboProblemDisp = columns.length - 1;
    if (mc === quantityCol) {
      ANALYSIS_COL_NAMES.forEach((an, k) => {
        columns.push({ kind: "analysis", name: an });
        displayToXlsxCol.push(analysisFinalPos(k));
        if (k === supplyDispIdx) supplyCol = columns.length - 1;
        if (k === statusDispIdx) statusCol = columns.length - 1;
      });
    }
    if (mc === yiboProblemCol && jzdColXlsx > 0) {
      columns.push({ kind: "jzd", name: JZD_HEADER });
      displayToXlsxCol.push(jzdColXlsx);
      jzdDisp = columns.length - 1;
    }
  });

  // 4) 填充数据行（Excel + TableData 同步）
  const rows: TableData["rows"] = [];
  const dataRowNums: number[] = [];

  for (const dr of opts.dataRows) {
    const xlsxRow = dr.xlsxRow;
    const result = dr.result;
    dataRowNums.push(xlsxRow);

    const analysisCells: CellData[] = result
      ? bakeAnalysisCells(result)
      : ANALYSIS_COL_NAMES.map(() => ({ v: "" }));

    let yiboGreen = false;
    let yiboProblemText = "";
    if (opts.runPhase2 && result && yiboProblemCol > 0) {
      let text = result.yiboProblem ?? "";
      const supplyIsYibo = result.supply === "一博供";
      const partStatus = result.partStatus ?? "";
      const yiboCode = result.yiboCode ?? "";
      if (supplyIsYibo && partStatus && partStatus !== "正常供货") {
        const suffix = `${yiboCode}${partStatus}，请一博在线重新选型`;
        if (!text || text.trim() === "") text = suffix;
        else if (!text.includes(suffix)) text = `${text}\n${suffix}`;
      }
      yiboProblemText = text;
      yiboGreen = supplyIsYibo && text.trim() !== "";
    }

    // 写入 Excel：分析列
    if (result) {
      ANALYSIS_COL_NAMES.forEach((an, k) => {
        const col = analysisFinalPos(k);
        const cell = ws.getCell(xlsxRow, col);
        cell.value = toCellValue(analysisCells[k].v);
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        const st = analysisCellStyle(an, result.highlight);
        if (st.bc) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: argbColor(st.bc) };
        }
        if (st.fc) {
          cell.font = { ...(cell.font || {}), color: argbColor(st.fc), bold: true };
        }
      });
    }
    // 写入 Excel：一博问题 + JZD
    if (yiboProblemCol > 0 && shiftedYiboProblem > 0) {
      const probCell = ws.getCell(xlsxRow, shiftedYiboProblem);
      if (yiboProblemText) {
        probCell.value = yiboProblemText;
        probCell.alignment = { vertical: "top", wrapText: true };
      }
      if (yiboGreen) {
        applyHighlight(probCell, "green");
        if (jzdColXlsx > 0) applyHighlight(ws.getCell(xlsxRow, jzdColXlsx), "green");
      }
    }

    // 构建 TableData 行
    const cells: CellData[] = [];
    let origIdx = 0;
    columns.forEach((c) => {
      if (c.kind === "orig") {
        cells.push({ v: dr.cells[origIdx] ?? "" });
        origIdx += 1;
      } else if (c.kind === "analysis") {
        const k = ANALYSIS_COL_NAMES.indexOf(c.name);
        cells.push(analysisCells[k] ?? { v: "" });
      } else {
        cells.push(yiboGreen ? { v: "", ...HIGHLIGHT_CSS.green } : { v: "" });
      }
    });

    rows.push({
      cells,
      highlight: result ? result.highlight : "none",
      yiboGreen,
    });
  }

  return {
    columns,
    rows,
    supplyCol,
    statusCol,
    yiboProblemCol: yiboProblemDisp,
    jzdCol: jzdDisp,
    runPhase2: opts.runPhase2,
    dataRows: dataRowNums,
    displayToXlsxCol,
    headerRow,
  };
}

/**
 * 将编辑后的 TableData 应用到输出 Excel（modifyOriginalBom 已生成的文件）。
 * 逐格写入值 + 颜色覆盖，保留原始样式。
 */
export async function applyEditsToWorkbook(
  sourcePath: string,
  table: TableData,
  outputPath: string,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourcePath);
  const ws = wb.worksheets[0];

  for (let i = 0; i < table.rows.length; i++) {
    const xlsxRow = table.dataRows[i];
    if (!xlsxRow) continue;
    const row = table.rows[i];
    for (let j = 0; j < table.columns.length; j++) {
      const xlsxCol = table.displayToXlsxCol[j];
      if (!xlsxCol) continue;
      const cellData = row.cells[j];
      if (!cellData) continue;
      const cell = ws.getCell(xlsxRow, xlsxCol);
      cell.value = toCellValue(cellData.v);
      if (cellData.fc) {
        cell.font = { ...(cell.font || {}), color: argbColor(cellData.fc) };
      }
      if (cellData.bc) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: argbColor(cellData.bc) };
      }
      if (cellData.b) {
        cell.font = { ...(cell.font || {}), bold: true };
      }
    }
  }

  await wb.xlsx.writeFile(outputPath);
}

export { ExcelJS };
