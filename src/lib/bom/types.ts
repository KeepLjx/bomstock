// ============================================================================
// BOM 库存全流程管理 —— 类型定义
// ============================================================================

/** 文件角色 */
export type BomRole = "target" | "occupied" | "inventory";

/** 文件类别（基于文件名/内容自动识别） */
export type FileKind = "bom" | "inventory" | "bills" | "transfer";

/** 解析后的单个文件信息 */
export interface ParsedFile {
  /** 临时存储的文件名（唯一） */
  storedName: string;
  /** 用户上传时的原始文件名 */
  originalName: string;
  /** 文件大小（字节） */
  size: number;
  /** 类别 */
  kind: FileKind;
  /** 角色（仅 bom 类别有意义） */
  role?: BomRole;
  /** 工作簿包含的工作表名 */
  sheets: string[];
  /** 主工作表名 */
  mainSheet: string;
  /** 主工作表的行数 */
  rowCount: number;
  /** 表头行号（从 1 开始） */
  headerRow: number;
  /** 表头：列索引(1-based) -> 列名（仅含有意义的列，已剔除空列/纯色列） */
  headers: Record<number, string>;
  /** 列名 -> 列索引 的反向映射 */
  headerMap: Record<string, number>;
  /** 是否含一博物料编码列 */
  hasYiboCode: boolean;
  /** 清洗后生成的 CSV 文件名（位于任务目录内），后续匹配基于此 */
  csvName?: string;
  /** 被剔除的无意义列数 */
  removedColumnCount?: number;
  /** 被忽略的 change log 工作表名 */
  ignoredChangeLog?: string[];
}

/** 列映射配置 */
export interface ColumnMapping {
  /** 单机用量列名 */
  usageColumn?: string;
  /** 存货/物料编码列名（BOM 侧） */
  bomCodeColumn?: string;
  /** 一博物料编码列名 */
  yiboCodeColumn?: string;
  /** 一博物料库存列名 */
  yiboStockColumn?: string;
  /** 一博问题列名 */
  yiboProblemColumn?: string;
  /** 零件状态列名 */
  partStatusColumn?: string;
  /** Quantity 列名（插入 6 列的锚点） */
  quantityColumn?: string;
  /** 已占用 BOM 的供料方式列名 */
  occupiedSupplyColumn?: string;
  /** 已占用 BOM 的复投/单机用量列名 */
  occupiedUsageColumn?: string;
}

/** 库存表列映射 */
export interface InventoryMapping {
  /** 物料编码列名 */
  codeColumn?: string;
  /** 总数量列名 */
  qtyColumn?: string;
}

/** BOM 角色与套数配置 */
export interface BomConfig {
  storedName: string;
  originalName: string;
  role: BomRole;
  sets: number;
}

/** 工作流配置 */
export interface WorkflowConfig {
  targetBom: BomConfig;
  inventory?: { storedName: string; originalName: string };
  inventoryMapping?: InventoryMapping;
  occupiedBoms: BomConfig[];
  targetMapping: ColumnMapping;
  /** 工单调拨齐套报表（用于扣减特殊判断） */
  workOrder?: { storedName: string; originalName: string };
  /** 是否执行阶段二 */
  runPhase2: boolean;
  /** 是否执行阶段三 */
  runPhase3: boolean;
}

/** 供料方式 */
export type SupplyMethod =
  | "客供：上架库存"
  | "一博供"
  | "客供";

/** 高亮颜色类型 */
export type HighlightColor = "none" | "blue" | "green" | "red";

/** 单行物料的匹配结果 */
export interface MaterialResult {
  /** 在工作表中的行号（1-based，含表头偏移） */
  row: number;
  /** 存货编码 */
  code: string;
  /** 一博物料编码 */
  yiboCode: string;
  /** 单机用量 */
  usage: number;
  /** 生产套数 */
  sets: number;
  /** 需求数量 */
  demand: number;
  /** 库存总数量（原始匹配） */
  totalStock: number | null;
  /** 扣减用量 */
  deduction: number;
  /** 可用库存 */
  availableStock: number | null;
  /** 一博库存（解析后数值） */
  yiboStock: number;
  /** 供料方式 */
  supply: SupplyMethod;
  /** 库存状态文本 */
  status: string;
  /** 高亮颜色 */
  highlight: HighlightColor;
  /** 零件状态 */
  partStatus?: string;
  /** 一博问题原文 */
  yiboProblem?: string;
  /** 场景编号 */
  scenario: string;
}

/** 工作流执行摘要 */
export interface WorkflowSummary {
  totalRows: number;
  /** 各供料方式计数 */
  supplyCounts: Record<SupplyMethod, number>;
  /** 欠料物料数（红色） */
  shortageCount: number;
  /** 蓝色提醒数 */
  blueCount: number;
  /** 深绿色数 */
  greenCount: number;
  /** 一博重新选型提示数 */
  reselectCount: number;
  /** 欠料明细（前若干条） */
  shortages: MaterialResult[];
  /** 目标 BOM 套数 */
  targetSets: number;
  /** 输出文件名 */
  outputFileName: string;
  /** 使用的场景标记 */
  appliedPhases: string[];
  /** 因工单确认而跳过扣减的 BOM 文件名列表 */
  skippedBoms?: string[];
  /** 实际参与扣减的 BOM 数量 */
  deductionBomCount?: number;
}

/** Job 状态 */
export interface JobState {
  id: string;
  status: "parsed" | "configured" | "done" | "error";
  files: ParsedFile[];
  config?: WorkflowConfig;
  summary?: WorkflowSummary;
  outputFileName?: string;
  error?: string;
  createdAt: number;
}

// ============================================================================
// 可编辑结果表格数据结构
// ============================================================================

/** 输出列类别 */
export type ColumnKind = "orig" | "analysis" | "jzd";

/** 输出列定义 */
export interface OutputColumn {
  name: string;
  kind: ColumnKind;
}

/** 单元格样式与值（支持网页端逐格编辑：值、字体色、背景色、加粗） */
export interface CellData {
  /** 单元格文本值 */
  v: string;
  /** 字体颜色覆盖 (#RRGGBB)，无则不覆盖 */
  fc?: string;
  /** 背景颜色覆盖 (#RRGGBB)，无则不覆盖 */
  bc?: string;
  /** 加粗 */
  b?: boolean;
}

/** 高亮颜色 -> 样式映射（网页 #RRGGBB 与 Excel 共用） */
export const HIGHLIGHT_CSS: Record<
  HighlightColor,
  { bc?: string; fc?: string }
> = {
  none: {},
  blue: { bc: "#4472C4", fc: "#FFFFFF" },
  green: { bc: "#00b050", fc: "#FFFFFF" },
  red: { bc: "#FFC7CE", fc: "#9C0006" },
};

/** 输出行（用于可编辑表格展示与导出） */
export interface OutputRow {
  /** 单元格（与 columns 对齐） */
  cells: CellData[];
  /** 6 个分析列的高亮颜色 */
  highlight: HighlightColor;
  /** 一博问题 + JZD确认 列是否标深绿（阶段二） */
  yiboGreen: boolean;
}

/** 完整结果表格（前端可编辑、后端导出共用） */
export interface TableData {
  columns: OutputColumn[];
  rows: OutputRow[];
  /** 供料方式列索引（0-based，-1 无） */
  supplyCol: number;
  /** 库存状态列索引（0-based，-1 无） */
  statusCol: number;
  /** 一博问题列索引（0-based，-1 无） */
  yiboProblemCol: number;
  /** JZD确认列索引（0-based，-1 无） */
  jzdCol: number;
  /** 是否执行了阶段二 */
  runPhase2: boolean;
  /** 导出映射：每个显示行对应的原始 Excel 行号（1-based） */
  dataRows: number[];
  /** 导出映射：每个显示列对应的输出 Excel 列号（1-based） */
  displayToXlsxCol: number[];
  /** 输出 Excel 的表头行号（1-based） */
  headerRow: number;
}
