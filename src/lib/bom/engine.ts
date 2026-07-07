// ============================================================================
// BOM 匹配引擎核心逻辑
// 包含：物料编码标准化、一博库存解析、需求计算、供料方式判定矩阵、扣减逻辑
// ============================================================================

import type {
  MaterialResult,
  SupplyMethod,
  HighlightColor,
} from "./types";

/**
 * 一博库存文本 -> 数值
 * "10K+"  -> 10000
 * "3K+"   -> 3000
 * "1K+"   -> 1000
 * "1K-"   -> 500
 * 包含 "库存不足" -> 0
 * NaN/空 -> 0
 */
export function parseYiboStock(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).trim();
  if (s === "" || s === "NaN") return 0;
  if (s.includes("库存不足")) return 0;

  // 先尝试纯数字
  const pure = Number(s.replace(/[,，\s]/g, ""));
  if (!isNaN(pure) && s.replace(/[,，\s]/g, "") !== "") {
    return pure;
  }

  // K / k 形式：如 10K+, 3K+, 1K+, 1K-, 1.5K+
  const m = s.match(/([\d.]+)\s*[Kk]\s*([+\-])/);
  if (m) {
    const base = parseFloat(m[1]);
    if (isNaN(base)) return 0;
    if (m[2] === "-") {
      // 1K- 视为 500
      return Math.round(base * 1000 * 0.5);
    }
    // 1K+ / 10K+ 取基数
    return Math.round(base * 1000);
  }
  // 仅 1K （无符号）按 1K+ 处理
  const m2 = s.match(/([\d.]+)\s*[Kk]\b/);
  if (m2) {
    const base = parseFloat(m2[1]);
    if (!isNaN(base)) return Math.round(base * 1000);
  }
  return 0;
}

/**
 * 标准化库存表物料编码 -> 存货编码
 * "C023219-0120405000034" -> "0120405000034"
 * 若无 "-"，原样返回（去空白）
 */
export function standardizeCode(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let s = String(raw).trim();
  if (s === "") return "";
  // 去除可能的科学计数法/小数（编码本应为字符串，但有时被识别为数字）
  if (s.includes("-")) {
    const parts = s.split("-");
    // 取最后一个 "-" 之后的部分作为存货编码
    s = parts[parts.length - 1];
  }
  // 去空白
  s = s.replace(/\s+/g, "");
  return s;
}

/** 规范化 BOM 侧编码用于匹配（保留前导零，转字符串） */
export function normalizeBomCode(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let s = String(raw).trim();
  // 如果是纯数字但被解析成科学计数法或浮点，尝试还原
  if (/^\d+(\.\d+)?e\+?(\d+)$/i.test(s)) {
    // 科学计数法还原为整数字符串
    const num = Number(s);
    if (!isNaN(num) && Number.isInteger(num)) {
      s = String(num);
    }
  }
  // 去除小数点（如 "120405000034.0"）
  if (/^\d+\.0+$/.test(s)) {
    s = s.replace(/\.0+$/, "");
  }
  return s.replace(/\s+/g, "");
}

/** 匹配 BOM 编码与库存编码（都标准化后比较） */
export function codesMatch(bomCode: unknown, invCode: unknown): boolean {
  const a = normalizeBomCode(bomCode);
  const b = standardizeCode(invCode);
  if (!a || !b) return false;
  if (a === b) return true;
  // 去前导零比较（容错）
  const strip = (x: string) => x.replace(/^0+/, "") || "0";
  return strip(a) === strip(b);
}

/**
 * 供料方式判定 —— 核心矩阵
 *
 * 场景:
 *  0.1 K>=D*2, Y>=D -> 客供：上架库存 (无色)
 *  0.2 K>=D*2, Y<D  -> 客供：上架库存 (无色)
 *  0.3 D<=K<D*2, Y>=D -> 客供：上架库存 (蓝)
 *  0.4 D<=K<D*2, Y<D  -> 客供：上架库存 (蓝)
 *  0.5a K<D, Y>=D 且 Y<=500(1K-) -> 一博供 (深绿)
 *  0.5b K<D, Y>=D 且 Y>500 -> 一博供 (无色)
 *  0.6  K<D, Y<D  -> 客供 (红)
 */
export interface SupplyInput {
  /** 可用库存数量 K（库存总数量 - 扣减；库存未找到时为 null） */
  availableStock: number | null;
  /** 一博库存 Y */
  yiboStock: number;
  /** 需求数量 D */
  demand: number;
}

export interface SupplyOutput {
  supply: SupplyMethod;
  highlight: HighlightColor;
  scenario: string;
  status: string;
  /** 用于显示的库存数量 */
  stockDisplay: number;
}

export function determineSupply(
  input: SupplyInput,
  context: { stockRaw: number | null; yiboStock: number; code?: string },
): SupplyOutput {
  const D = input.demand;
  const Y = input.yiboStock ?? 0;
  // 可用库存：null 视为 0（未找到）
  const K = input.availableStock === null ? 0 : input.availableStock;
  const stockDisplay = input.availableStock === null ? 0 : input.availableStock;

  // 库存为空/未找到
  const noStock = input.availableStock === null;

  if (D <= 0) {
    // 无需求，默认客供上架库存（无色），状态显示库存
    return {
      supply: "客供：上架库存",
      highlight: "none",
      scenario: "0.0",
      status: `库存：${stockDisplay}，一博：${Y}`,
      stockDisplay,
    };
  }

  // 0.1 / 0.2 库存远大于 (K >= D*2)
  if (K >= D * 2) {
    return {
      supply: "客供：上架库存",
      highlight: "none",
      scenario: Y >= D ? "0.1" : "0.2",
      status: noStock
        ? `客供（库存：0，一博：${Y}）`
        : `库存：${stockDisplay}，一博：${Y}`,
      stockDisplay,
    };
  }

  // 0.3 / 0.4 库存满足但非远大于 (D <= K < D*2)
  if (K >= D && K < D * 2) {
    return {
      supply: "客供：上架库存",
      highlight: "blue",
      scenario: Y >= D ? "0.3" : "0.4",
      status: noStock
        ? `客供（库存：0，一博：${Y}）`
        : `库存：${stockDisplay}，一博：${Y}`,
      stockDisplay,
    };
  }

  // 0.5a / 0.5b 库存不足 (K < D)，一博可满足 (Y >= D)
  if (K < D && Y >= D) {
    if (Y <= 500) {
      return {
        supply: "一博供",
        highlight: "green",
        scenario: "0.5a",
        status: `一博库存：${Y}（紧张）`,
        stockDisplay,
      };
    }
    return {
      supply: "一博供",
      highlight: "none",
      scenario: "0.5b",
      status: `一博库存：${Y}`,
      stockDisplay,
    };
  }

  // 0.6 两种均不足 (K < D, Y < D) -> 客供（红）
  return {
    supply: "客供",
    highlight: "red",
    scenario: "0.6",
    status: `客供（库存：${stockDisplay}，一博：${Y}）`,
    stockDisplay,
  };
}

/** 构建欠料/不足状态文本（场景 0.6） */
export function shortageStatus(
  stockDisplay: number,
  yiboStock: number,
): string {
  return `客供（库存：${stockDisplay}，一博：${yiboStock}）`;
}

/** 供料方式中文标签计数辅助 */
export function emptySupplyCounts(): Record<SupplyMethod, number> {
  return { "客供：上架库存": 0, 一博供: 0, 客供: 0 };
}

/** 根据一组 MaterialResult 汇总摘要统计 */
export function summarizeResults(results: MaterialResult[]): {
  totalRows: number;
  shortageCount: number;
  blueCount: number;
  greenCount: number;
  supplyCounts: Record<SupplyMethod, number>;
} {
  const supplyCounts = emptySupplyCounts();
  let shortageCount = 0;
  let blueCount = 0;
  let greenCount = 0;
  for (const r of results) {
    supplyCounts[r.supply] = (supplyCounts[r.supply] ?? 0) + 1;
    if (r.highlight === "red") shortageCount += 1;
    if (r.highlight === "blue") blueCount += 1;
    if (r.highlight === "green") greenCount += 1;
  }
  return {
    totalRows: results.length,
    shortageCount,
    blueCount,
    greenCount,
    supplyCounts,
  };
}
