// 前端共享类型（与 API 响应对齐）
export interface ParsedFileDTO {
  storedName: string;
  originalName: string;
  kind: "bom" | "inventory" | "bills" | "transfer";
  role?: "target" | "occupied" | "inventory";
  hasYiboCode: boolean;
  rowCount: number;
  headerRow: number;
  mainSheet: string;
  sheets: string[];
  /** 被剔除的空列/纯色列数 */
  removedColumnCount: number;
  /** 被忽略的 change log 工作表名 */
  ignoredChangeLog: string[];
  headers: { col: number; name: string }[];
  /** 自动检测到的生产套数（已占用 BOM 默认值） */
  detectedSets?: number | null;
}

export interface UploadResponse {
  jobId: string;
  files: ParsedFileDTO[];
  yiboWarning: string | null;
  /** 本次上传中被更新为持久资源的库存/工单表 */
  updatedResources?: {
    kind: "inventory" | "work_order";
    file: ParsedFileDTO;
  }[];
}
/** 持久资源（库存表 / 工单表）状态 */
export interface ResourceStatus {
  id: "inventory" | "work_order";
  exists: boolean;
  updatedToday: boolean;
  updatedAt?: string;
  file?: ParsedFileDTO;
}

export interface ResourcesState {
  inventory: ResourceStatus;
  workOrder: ResourceStatus;
}

export interface SupplyCounts {
  "客供：上架库存": number;
  一博供: number;
  客供: number;
}

export interface ShortageItem {
  code: string;
  yiboCode: string;
  demand: number;
  totalStock: number | null;
  availableStock: number | null;
  yiboStock: number;
  supply: string;
  status: string;
}

export interface WorkflowSummaryDTO {
  totalRows: number;
  supplyCounts: SupplyCounts;
  shortageCount: number;
  blueCount: number;
  greenCount: number;
  reselectCount: number;
  shortages: ShortageItem[];
  targetSets: number;
  outputFileName: string;
  appliedPhases: string[];
  skippedBoms?: string[];
  deductionBomCount?: number;
}

export type ColumnKind = "orig" | "analysis" | "jzd";

export interface OutputColumnDTO {
  name: string;
  kind: ColumnKind;
}

export type HighlightColor = "none" | "blue" | "green" | "red";

export interface CellDataDTO {
  v: string;
  fc?: string;
  bc?: string;
  b?: boolean;
}

export interface OutputRowDTO {
  cells: CellDataDTO[];
  highlight: HighlightColor;
  yiboGreen: boolean;
}

export interface TableDataDTO {
  columns: OutputColumnDTO[];
  rows: OutputRowDTO[];
  supplyCol: number;
  statusCol: number;
  yiboProblemCol: number;
  jzdCol: number;
  runPhase2: boolean;
  dataRows: number[];
  displayToXlsxCol: number[];
  headerRow: number;
}

export interface ProcessResponse {
  jobId: string;
  summary: WorkflowSummaryDTO;
  table: TableDataDTO;
  addedColumns: string[];
  outputFileName: string;
}
/** 预览弹窗数据（基于清洗后的 CSV） */
export interface PreviewResponse {
  columns: string[];
  rows: string[][];
  totalRows: number;
  limited: number;
}
export const KIND_LABELS: Record<ParsedFileDTO["kind"], string> = {
  bom: "BOM 文件",
  inventory: "库存表",
  bills: "单据列表",
  transfer: "调拨齐套报表",
};

export const ROLE_LABELS: Record<string, string> = {
  target: "目标 BOM",
  occupied: "已占用客供库存的 BOM",
  inventory: "库存表",
};
