import type { ParsedFile } from "./types";
/**
 * 解析文件 -> 前端可消费的 DTO
 * 统一多个 API 路由（upload / delete / sheet / resources）的输出结构
 */
export interface ParsedFileDTO {
  storedName: string;
  originalName: string;
  kind: ParsedFile["kind"];
  role?: ParsedFile["role"];
  hasYiboCode: boolean;
  rowCount: number;
  headerRow: number;
  mainSheet: string;
  sheets: string[];
  removedColumnCount: number;
  ignoredChangeLog: string[];
  headers: { col: number; name: string }[];
  /** 自动检测到的生产套数（已占用 BOM 默认值） */
  detectedSets?: number | null;
}
export function parsedFileToDTO(p: ParsedFile): ParsedFileDTO {
  return {
    storedName: p.storedName,
    originalName: p.originalName,
    kind: p.kind,
    role: p.role,
    hasYiboCode: p.hasYiboCode,
    rowCount: p.rowCount,
    headerRow: p.headerRow,
    mainSheet: p.mainSheet,
    sheets: p.sheets,
    removedColumnCount: p.removedColumnCount ?? 0,
    ignoredChangeLog: p.ignoredChangeLog ?? [],
    headers: Object.entries(p.headers)
      .map(([col, name]) => ({ col: Number(col), name }))
      .sort((a, b) => a.col - b.col),
    detectedSets: p.detectedSets ?? null,
  };
}