// ============================================================================
// BOM 列名别名集合
// ============================================================================

/** 一博物料编码 */
export const YIBO_CODE_ALIASES = [
  "一博物料编码",
  "一博编码",
  "一博料号",
  "YiboCode",
  "YiboPart",
];

/** 一博物料库存 */
export const YIBO_STOCK_ALIASES = [
  "一博物料库存",
  "一博库存",
  "一博可用库存",
  "在库数量",
  "YiboStock",
];

/** 一博问题 */
export const YIBO_PROBLEM_ALIASES = [
  "一博问题",
  "一博备注",
  "一博异常",
  "一博提示",
  "YiboProblem",
];

/** 零件状态 */
export const PART_STATUS_ALIASES = [
  "零件状态",
  "器件状态",
  "生命周期",
  "PartStatus",
  "Lifecycle",
];

/** 单机用量 */
export const USAGE_ALIASES = [
  "Quantity",
  "单机用量",
  "单板用量",
  "单台用量",
  "用量",
  "Qty",
  "USAGE",
];

/**
 * BOM 物料/存货编码（各 BOM 表中物料编码列名不同）
 * 存货编码 / 精智达编码 / Part Number 等，统一为 13 位物料编码（如 0120405000034）
 */
export const BOM_CODE_ALIASES = [
  "存货编码",
  "精智达编码",
  "PartNumber",
  "物料编码",
  "客户料号",
  "编码",
  "料号",
  "物料号",
  "MaterialCode",
  "Code",
];

/** Quantity 列（插入锚点 + 单机用量计算基准） */
export const QUANTITY_ALIASES = [
  "Quantity",
  "数量",
  "Qty",
  "用量",
];

/**
 * 需求数量列（总需求，已含套数）
 * 匹配 总需求数（N套）/ 需求数量(N套) / 总需求数 等变体
 */
export const DEMAND_ALIASES = [
  "需求数量",
  "总需求数",
  "需求数",
  "总需求",
];

/** 供料方式列 */
export const SUPPLY_ALIASES = [
  "供料方式",
  "复投供料方式",
  "JZD供料方式",
  "物料提供方式",
  "供料",
  "SupplyMethod",
];

/** 库存表物料编码 */
export const INVENTORY_CODE_ALIASES = [
  "物料编码",
  "存货编码",
  "编码",
  "料号",
  "MaterialCode",
  "Code",
];

/** 物料名称（库存表 / BOM 通用） */
export const MATERIAL_NAME_ALIASES = [
  "物料名称",
  "品名",
  "名称",
  "物料描述",
  "存货名称",
  "MaterialName",
  "Description",
  "Name",
];

/** 规格型号 */
export const SPEC_ALIASES = [
  "规格",
  "规格型号",
  "型号",
  "规格描述",
  "Spec",
  "Specification",
];

/** 库存表总数量 */
export const INVENTORY_QTY_ALIASES = [
  "总数量",
  "现存数量",
  "库存数量",
  "可用数量",
  "在库数量",
  "数量",
  "Quantity",
  "Qty",
  "TotalQty",
];

/** 工单调拨齐套报表 — 成品名称列 */
export const WORK_ORDER_PRODUCT_ALIASES = [
  "成品名称",
  "成品",
  "产品名称",
  "ProductName",
];

/** 工单调拨齐套报表 — 计划数量（实际为套数）列 */
export const WORK_ORDER_QTY_ALIASES = [
  "计划数量",
  "计划套数",
  "计划数",
  "套数",
  "PlanQty",
];
