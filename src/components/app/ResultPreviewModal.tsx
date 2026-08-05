"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface CellData {
  v: string;
  fc?: string;
  bc?: string;
  b?: boolean;
}
interface OutputColumn {
  name: string;
  kind: string;
}
interface OutputRow {
  cells: CellData[];
  highlight: string;
  yiboGreen: boolean;
}
interface TableData {
  columns: OutputColumn[];
  rows: OutputRow[];
  supplyCol: number;
  statusCol: number;
  runPhase2: boolean;
}

const HIGHLIGHT_CSS: Record<string, { bc?: string; fc?: string }> = {
  none: {},
  blue: { bc: "#4472C4", fc: "#FFFFFF" },
  green: { bc: "#00b050", fc: "#FFFFFF" },
  red: { bc: "#FFC7CE", fc: "#9C0006" },
};

const DEFAULT_W = 130;
const DEFAULT_H = 30;

export default function ResultPreviewModal({
  jobId,
  name,
  onClose,
}: {
  jobId: string;
  name: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<TableData | null>(null);
  const [summary, setSummary] = useState<{
    totalRows?: number;
    shortageCount?: number;
    blueCount?: number;
    greenCount?: number;
    skippedBoms?: string[];
    deductionBomCount?: number;
  } | null>(null);
  const [colWidths, setColWidths] = useState<number[]>([]);
  const [activeResize, setActiveResize] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/bom/result?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "获取结果失败");
      const t = json.table as TableData;
      setTable(t);
      setSummary(json.summary ?? null);
      setColWidths(t.columns.map((c) => (c.kind === "analysis" ? 110 : 150)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取结果失败");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleColResizeStart(e: React.PointerEvent, ci: number) {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[ci] ?? DEFAULT_W;
    setActiveResize(`col-${ci}`);
    const onMove = (ev: PointerEvent) => {
      const newW = Math.max(50, Math.round(startW + ev.clientX - startX));
      setColWidths((prev) => {
        const next = [...prev];
        next[ci] = newW;
        return next;
      });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setActiveResize(null);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const cols = table?.columns ?? [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/50" onClick={onClose}>
      <div
        className="mx-auto flex h-[88vh] w-[94vw] max-w-[1600px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-[#dadce0] px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-medium text-[#202124]">BOM 匹配结果 · {name}</h2>
            {summary && (
              <p className="mt-0.5 text-xs text-[#5f6368]">
                共 {summary.totalRows ?? 0} 行 · 欠料 {summary.shortageCount ?? 0} · 蓝色 {summary.blueCount ?? 0} · 绿色 {summary.greenCount ?? 0}
                {typeof summary.deductionBomCount === "number" ? ` · 扣减 ${summary.deductionBomCount} 个 BOM` : ""}
                {summary.skippedBoms && summary.skippedBoms.length > 0 ? ` · 工单跳过 ${summary.skippedBoms.length}` : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/bom/download?jobId=${encodeURIComponent(jobId)}&file=${encodeURIComponent(table ? "" : "")}`}
              className="hidden rounded-full border border-[#dadce0] px-3 py-1.5 text-xs font-medium text-[#3c4043] transition hover:bg-[#f1f3f4]"
            >
              下载
            </a>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4]"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="border-b border-[#e8eaed] bg-[#f8f9fa] px-5 py-1.5 text-xs text-[#5f6368]">
          提示：拖拽表头右侧边缘调整<strong>列宽</strong>。颜色含义：<span className="text-[#1a73e8]">蓝</span> 库存满足但非远大于 ·{" "}
          <span className="text-[#00b050]">绿</span> 一博供 · <span className="text-[#9C0006]">红</span> 欠料
        </div>
        {/* 表格区 */}
        <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
          {loading && (
            <div className="flex h-64 items-center justify-center text-sm text-[#5f6368]">
              <span className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-[#dadce0] border-t-[#1a73e8]" />
              正在读取匹配结果…
            </div>
          )}
          {error && (
            <div className="flex h-64 flex-col items-center justify-center px-6 text-center text-sm text-[#d93025]">
              <p>{error}</p>
              <button onClick={fetchData} className="mt-3 rounded-md bg-[#1a73e8] px-4 py-1.5 text-xs font-medium text-white">重试</button>
            </div>
          )}
          {!loading && !error && table && (
            <table className="border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-[#dadce0] bg-[#f1f3f4] px-2 text-center font-medium text-[#5f6368]" style={{ width: 44 }}>#</th>
                  {cols.map((col, ci) => (
                    <th
                      key={ci}
                      className={`relative select-none border-b border-r border-[#dadce0] px-2 py-1.5 text-left font-medium ${
                        col.kind === "analysis" ? "bg-[#e8f0fe] text-[#1a73e8]" : "bg-[#f1f3f4] text-[#202124]"
                      }`}
                      style={{ width: colWidths[ci] ?? DEFAULT_W }}
                    >
                      <span className="block truncate">{col.name}</span>
                      <span
                        onPointerDown={(e) => handleColResizeStart(e, ci)}
                        className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize ${
                          activeResize === `col-${ci}` ? "bg-[#1a73e8]" : "bg-transparent hover:bg-[#1a73e8]/40"
                        }`}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => {
                  const hl = HIGHLIGHT_CSS[row.highlight] ?? {};
                  return (
                    <tr key={ri}>
                      <td className="sticky left-0 z-10 border-b border-r border-[#e8eaed] bg-[#f8f9fa] px-2 text-center text-[#9aa0a6]">{ri + 1}</td>
                      {row.cells.map((cell, ci) => {
                        const col = cols[ci];
                        const isAnalysis = col?.kind === "analysis";
                        // 分析列：用行高亮底色（蓝/绿/红）；单元格自带样式覆盖
                        const bc = cell.bc ?? (isAnalysis ? hl.bc : undefined);
                        const fc = cell.fc ?? (isAnalysis ? hl.fc : undefined);
                        return (
                          <td
                            key={ci}
                            className="overflow-hidden border-b border-r border-[#e8eaed] px-2 align-middle"
                            style={{
                              width: colWidths[ci] ?? DEFAULT_W,
                              maxWidth: colWidths[ci] ?? DEFAULT_W,
                              height: DEFAULT_H,
                              background: bc,
                              color: fc,
                              fontWeight: cell.b ? 700 : undefined,
                            }}
                          >
                            <div className="truncate" title={cell.v}>{cell.v}</div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {table.rows.length === 0 && (
                  <tr>
                    <td colSpan={cols.length + 1} className="px-4 py-10 text-center text-sm text-[#9aa0a6]">无数据行</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-[#dadce0] px-5 py-3">
          <span className="text-xs text-[#9aa0a6]">含插入的分析列（供料方式、库存状态、扣减、可用库存等）与颜色标记</span>
          <button onClick={onClose} className="rounded-full bg-[#1a73e8] px-5 py-1.5 text-sm font-medium text-white transition hover:bg-[#1765cc]">关闭</button>
        </div>
      </div>
    </div>
  );
}
