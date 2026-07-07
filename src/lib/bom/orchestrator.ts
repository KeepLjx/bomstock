// ============================================================================
// 工作流编排器
// 目标 BOM：读取原始 XLSX（保留样式/空列/合并单元格），就地插入分析列
// 库存表 / 已占用 BOM：读取清洗 CSV（快速匹配与扣减）
// ============================================================================

import path from "node:path";
import { filePathOf } from "./storage";
import { readCSV, tableStr, type CleanedTable } from "./csv";
import {
  findHeaderColumn,
  parseLooseNumber,
  cellToString,
  cellToNumber,
  prepareWorksheet,
  extractProductName,
} from "./parse";
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
  WORK_ORDER_PRODUCT_ALIASES,
  WORK_ORDER_QTY_ALIASES,
} from "./aliases";
import {
  parseYiboStock,
  standardizeCode,
  normalizeBomCode,
  determineSupply,
  summarizeResults,
} from "./engine";
import { modifyOriginalBom, ANALYSIS_COL_NAMES } from "./excel-writer";
import type {
  WorkflowConfig,
  MaterialResult,
  JobState,
  WorkflowSummary,
  SupplyMethod,
  TableData,
} from "./types";

export const SIX_HEADER_NAMES = ANALYSIS_COL_NAMES;

/** 从 CSV 构建库存查询：标准化编码 -> 总数量 */
function buildInventoryLookup(
  table: CleanedTable,
  mapping: { codeColumn?: string; qtyColumn?: string },
): ((code: string) => number | null) | null {
  const codeName =
    mapping.codeColumn || findHeaderColumn(table.headerMap, INVENTORY_CODE_ALIASES);
  const qtyName =
    mapping.qtyColumn || findHeaderColumn(table.headerMap, INVENTORY_QTY_ALIASES);
  if (!codeName || !qtyName) return null;

  const exact = new Map<string, number>();
  const stripped = new Map<string, number>();
  for (const row of table.rows) {
    const codeStr = tableStr(table, row, codeName);
    if (!codeStr) continue;
    const std = standardizeCode(codeStr);
    if (!std) continue;
    const q = parseLooseNumber(tableStr(table, row, qtyName)) ?? 0;
    exact.set(std, (exact.get(std) ?? 0) + q);
    const strip = std.replace(/^0+/, "") || "0";
    stripped.set(strip, (stripped.get(strip) ?? 0) + q);
  }
  return (code: string): number | null => {
    if (!code) return null;
    const norm = normalizeBomCode(code);
    if (exact.has(norm)) return exact.get(norm)!;
    const strip = norm.replace(/^0+/, "") || "0";
    if (stripped.has(strip)) return stripped.get(strip)!;
    return null;
  };
}

/**
 * 从已占用 BOM 的 CSV 构建扣减量 map：标准化编码 -> 需求数量。
 * 优先读取「需求数量/总需求数」列（已含套数）；若不存在则用 单机用量 × 套数。
 */
function buildDeductionLookup(
  table: CleanedTable,
  sets: number,
): Map<string, number> {
  const codeName = findHeaderColumn(table.headerMap, BOM_CODE_ALIASES);
  if (!codeName) return new Map();

  // 优先使用「需求数量」列（总需求数(N套) 等）
  const demandName = findHeaderColumn(table.headerMap, DEMAND_ALIASES);
  // 回退：单机用量列
  const usageName = findHeaderColumn(table.headerMap, USAGE_ALIASES);

  if (!demandName && !usageName) return new Map();

  const dedMap = new Map<string, number>();
  for (const row of table.rows) {
    const codeStr = tableStr(table, row, codeName);
    if (!codeStr) continue;
    const norm = normalizeBomCode(codeStr);
    if (!norm) continue;

    let ded: number;
    if (demandName) {
      // 直接读需求数量列（已含套数）
      ded = parseLooseNumber(tableStr(table, row, demandName)) ?? 0;
    } else {
      // 回退：单机用量 × 套数
      const usage = parseLooseNumber(tableStr(table, row, usageName!)) ?? 0;
      ded = usage * sets;
    }
    if (ded > 0) {
      dedMap.set(norm, (dedMap.get(norm) ?? 0) + ded);
    }
  }
  return dedMap;
}

/**
 * 从工单调拨齐套报表构建查询：检查某产品的生产是否已在工单中确认。
 * 返回一个函数：(productName, sets) => boolean（true = 该 BOM 的扣减应跳过）
 */
function buildWorkOrderChecker(
  table: CleanedTable | null,
): ((productName: string, sets: number) => boolean) | null {
  if (!table) return null;
  const productNameCol = findHeaderColumn(table.headerMap, WORK_ORDER_PRODUCT_ALIASES);
  const qtyCol = findHeaderColumn(table.headerMap, WORK_ORDER_QTY_ALIASES);
  if (!productNameCol || !qtyCol) return null;

  // 成品名称 -> 计划数量(套数) 的去重集合
  const entries: { name: string; qty: number }[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    const name = tableStr(table, row, productNameCol).toUpperCase();
    if (!name) continue;
    const qty = parseLooseNumber(tableStr(table, row, qtyCol));
    const key = `${name}|${qty ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (qty !== null) entries.push({ name, qty });
  }

  return (productName: string, sets: number): boolean => {
    if (!productName) return false;
    const pn = productName.toUpperCase();
    for (const e of entries) {
      // 工单成品名称包含产品名称，且计划数量(套数)匹配
      if (e.name.includes(pn) && e.qty === sets) return true;
    }
    return false;
  };
}

export interface ExecuteOptions {
  jobId: string;
  state: JobState;
  config: WorkflowConfig;
}

export interface ExecuteResult {
  summary: WorkflowSummary;
  outputPath: string;
  table: TableData;
}

/** 执行完整工作流：匹配 -> 就地修改原始 BOM -> 输出 XLSX + TableData */
export async function executeWorkflow(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { jobId, state, config } = opts;

  const targetFile = state.files.find(
    (f) => f.storedName === config.targetBom.storedName,
  );
  if (!targetFile) throw new Error("未找到目标 BOM 文件");

  const originalPath = filePathOf(jobId, targetFile.storedName);
  const targetSets = config.targetBom.sets || 1;

  // 1) 读取原始目标 BOM（保留样式）
  const sheet = await prepareWorksheet(originalPath, targetFile.mainSheet);
  const ws = sheet.worksheet;
  const headerRow = sheet.headerRow;
  const headerMap = sheet.headerMap;
  const meaningfulCols = sheet.meaningfulCols;
  const lastDataRow = sheet.lastDataRow;
  const mapping = config.targetMapping;

  const usageName = mapping.usageColumn || findHeaderColumn(headerMap, USAGE_ALIASES);
  const bomCodeName = mapping.bomCodeColumn || findHeaderColumn(headerMap, BOM_CODE_ALIASES);
  const yiboCodeName = mapping.yiboCodeColumn || findHeaderColumn(headerMap, YIBO_CODE_ALIASES);
  const yiboStockName = mapping.yiboStockColumn || findHeaderColumn(headerMap, YIBO_STOCK_ALIASES);
  const yiboProblemName = mapping.yiboProblemColumn || findHeaderColumn(headerMap, YIBO_PROBLEM_ALIASES);
  const partStatusName = mapping.partStatusColumn || findHeaderColumn(headerMap, PART_STATUS_ALIASES);
  const quantityName = mapping.quantityColumn || findHeaderColumn(headerMap, QUANTITY_ALIASES);

  if (!usageName)
    throw new Error("目标 BOM 未找到「单机用量 / Quantity」列，请在列映射中指定");
  if (!bomCodeName)
    throw new Error("目标 BOM 未找到「存货编码 / 物料编码」列，请在列映射中指定");

  const usageCol = headerMap[usageName];
  const bomCodeCol = headerMap[bomCodeName];
  const yiboCodeCol = yiboCodeName ? headerMap[yiboCodeName] : -1;
  const yiboStockCol = yiboStockName ? headerMap[yiboStockName] : -1;
  const yiboProblemCol = yiboProblemName ? headerMap[yiboProblemName] : -1;
  const partStatusCol = partStatusName ? headerMap[partStatusName] : -1;
  const quantityCol = quantityName ? headerMap[quantityName] : usageCol;

  // 2) 加载库存表 CSV
  let lookup: ((code: string) => number | null) | null = null;
  if (config.inventory) {
    const invFile = state.files.find(
      (f) => f.storedName === config.inventory!.storedName,
    );
    if (invFile?.csvName) {
      const invTable = readCSV(filePathOf(jobId, invFile.csvName));
      lookup = buildInventoryLookup(invTable, config.inventoryMapping ?? {});
    }
  }

  // 3) 加载工单调拨齐套报表（用于扣减特殊判断）
  let workOrderChecker: ((productName: string, sets: number) => boolean) | null = null;
  if (config.workOrder) {
    const woFile = state.files.find((f) => f.storedName === config.workOrder!.storedName);
    if (woFile?.csvName) {
      const woTable = readCSV(filePathOf(jobId, woFile.csvName));
      workOrderChecker = buildWorkOrderChecker(woTable);
    }
  }

  // 4) 加载已占用 BOM 扣减（CSV），应用工单特殊判断
  const dedMaps: Map<string, number>[] = [];
  const skippedBoms: string[] = [];
  for (const ob of config.occupiedBoms) {
    const obFile = state.files.find((f) => f.storedName === ob.storedName);
    if (!obFile?.csvName) continue;

    // 工单特殊判断：成品名称包含产品名 + 计划数量=套数 → 跳过扣减
    if (workOrderChecker) {
      const productName = extractProductName(ob.originalName);
      const sets = ob.sets || 1;
      if (workOrderChecker(productName, sets)) {
        skippedBoms.push(ob.originalName);
        continue; // 不统计该 BOM 的扣减用量
      }
    }

    const obTable = readCSV(filePathOf(jobId, obFile.csvName));
    dedMaps.push(buildDeductionLookup(obTable, ob.sets || 1));
  }
  const totalDeduction = (code: string): number => {
    let sum = 0;
    for (const m of dedMaps) sum += m.get(code) ?? 0;
    return sum;
  };

  // 4) 计算每行结果（直接读取原始 XLSX 行）
  const results: MaterialResult[] = [];
  const dataRows: { xlsxRow: number; cells: string[]; result?: MaterialResult }[] = [];

  for (let r = headerRow + 1; r <= lastDataRow; r++) {
    const rowObj = ws.getRow(r);
    // 读取有意义列的值
    const cells = meaningfulCols.map((c) => cellToString(rowObj.getCell(c)));
    if (cells.every((s) => s.trim() === "")) continue; // 跳过完全空行

    const usage = cellToNumber(rowObj.getCell(usageCol)) ?? 0;
    const code = normalizeBomCode(cellToString(rowObj.getCell(bomCodeCol)));
    const yiboCode = yiboCodeCol > 0 ? cellToString(rowObj.getCell(yiboCodeCol)) : "";
    const yiboStockRaw = yiboStockCol > 0 ? rowObj.getCell(yiboStockCol).value : "";
    const yiboStock = parseYiboStock(yiboStockRaw);
    const demand = usage * targetSets;

    const totalStock = lookup ? lookup(code) : null;
    const deduction = totalDeduction(code);
    const availableStock = totalStock === null ? null : totalStock - deduction;

    const out = determineSupply(
      { availableStock, yiboStock, demand },
      { stockRaw: totalStock, yiboStock, code },
    );

    const result: MaterialResult = {
      row: r,
      code,
      yiboCode,
      usage,
      sets: targetSets,
      demand,
      totalStock,
      deduction,
      availableStock,
      yiboStock,
      supply: out.supply,
      status: out.status,
      highlight: out.highlight,
      scenario: out.scenario,
      partStatus: partStatusCol > 0 ? cellToString(rowObj.getCell(partStatusCol)) : "",
      yiboProblem: yiboProblemCol > 0 ? cellToString(rowObj.getCell(yiboProblemCol)) : "",
    };
    results.push(result);
    dataRows.push({ xlsxRow: r, cells, result });
  }

  // 5) 在原始 BOM 上就地修改 -> TableData
  const table = modifyOriginalBom({
    worksheet: ws,
    headerRow,
    meaningfulCols,
    dataRows,
    quantityCol,
    yiboProblemCol: yiboProblemCol > 0 ? yiboProblemCol : -1,
    runPhase2: config.runPhase2,
    colNames: meaningfulCols.map((c) => sheet.headers[c] || `列${c}`),
  });

  // 6) 保存输出 XLSX（保留原始样式）
  const outName = `BOM供料方式_${targetFile.originalName.replace(/\.(xlsx|xlsm|xls)$/i, "")}_${Date.now()}.xlsx`;
  const outputPath = path.join(path.dirname(originalPath), outName);
  await sheet.workbook.xlsx.writeFile(outputPath);

  // 7) 摘要
  const stats = summarizeResults(results);
  const supplyCounts: Record<SupplyMethod, number> = {
    "客供：上架库存": stats.supplyCounts["客供：上架库存"] ?? 0,
    一博供: stats.supplyCounts["一博供"] ?? 0,
    客供: stats.supplyCounts["客供"] ?? 0,
  };
  const reselectCount = results.filter(
    (r) => r.supply === "一博供" && r.partStatus && r.partStatus !== "正常供货",
  ).length;
  const shortages = results.filter((r) => r.highlight === "red").slice(0, 30);

  const appliedPhases = ["阶段一：BOM库存匹配与供料方式判定"];
  if (config.runPhase2) appliedPhases.push("阶段二：一博问题与零件状态标记");
  if (config.runPhase3 && config.occupiedBoms.length > 0) {
    appliedPhases.push("阶段三：已占用客供库存扣减");
  }

  const summary: WorkflowSummary = {
    totalRows: stats.totalRows,
    supplyCounts,
    shortageCount: stats.shortageCount,
    blueCount: stats.blueCount,
    greenCount: stats.greenCount,
    reselectCount,
    shortages,
    targetSets,
    outputFileName: outName,
    appliedPhases,
    skippedBoms,
    deductionBomCount: dedMaps.length,
  };

  return { summary, outputPath, table };
}
