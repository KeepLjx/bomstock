"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewResponse } from "./types";
interface Props {
  jobId?: string;
  storedName?: string;
  /** 预览持久资源：inventory | work_order */
  kind?: "inventory" | "work_order";
  originalName: string;
  onClose: () => void;
}
const DEFAULT_COL_WIDTH = 140;
const DEFAULT_ROW_HEIGHT = 32;
const PREVIEW_LIMIT = 100;
/**
 * 表格预览弹窗：
 *  - 点击表名后弹出，展示当前工作表的数据
 *  - 可拖拽调整列宽（表头右边缘）与行高（行号下边缘）
 */
export default function SheetPreviewModal({
  jobId,
  storedName,
  kind,
  originalName,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [colWidths, setColWidths] = useState<number[]>([]);
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({});
  const [activeResize, setActiveResize] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bom/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind
            ? { kind, limit: PREVIEW_LIMIT }
            : { jobId: jobId ?? "", storedName: storedName ?? "", limit: PREVIEW_LIMIT },
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "获取预览失败");
      setData(json as PreviewResponse);
      setColWidths(
        (json as PreviewResponse).columns.map((c) =>
          Math.min(320, Math.max(80, c.length * 14 + 32)),
        ),
      );
      setRowHeights({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取预览失败");
    } finally {
      setLoading(false);
    }
  }, [jobId, storedName, kind]);
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // ---- 列宽调整 ----
  const handleColResizeStart = (e: React.PointerEvent, ci: number) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[ci] ?? DEFAULT_COL_WIDTH;
    setActiveResize(`col-${ci}`);
    const onMove = (ev: PointerEvent) => {
      const newW = Math.max(50, Math.round(startW + (ev.clientX - startX)));
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
  };
  // ---- 行高调整 ----
  const handleRowResizeStart = (e: React.PointerEvent, ri: number) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startH = rowHeights[ri] ?? DEFAULT_ROW_HEIGHT;
    setActiveResize(`row-${ri}`);
    const onMove = (ev: PointerEvent) => {
      const newH = Math.max(24, Math.round(startH + (ev.clientY - startY)));
      setRowHeights((prev) => ({ ...prev, [ri]: newH }));
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
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };
  const resetSizes = () => {
    if (!data) return;
    setColWidths(
      data.columns.map((c) => Math.min(320, Math.max(80, c.length * 14 + 32))),
    );
    setRowHeights({});
  };
  const rows = data?.rows ?? [];
  const columns = data?.columns ?? [];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-[#dadce0] px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-[#202124]">
              📄 {originalName}
            </h3>
            <p className="mt-0.5 text-xs text-[#5f6368]">
              {loading
                ? "加载中…"
                : `${columns.length} 列 · ${
                    data ? data.totalRows : 0
                  } 行（预览前 ${data?.limited ?? 0} 行）`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={resetSizes}
              disabled={loading || !!error}
              className="rounded-full border border-[#dadce0] px-3 py-1.5 text-xs font-medium text-[#3c4043] transition hover:bg-[#f1f3f4] disabled:opacity-50"
            >
              重置宽高
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4]"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        </div>
        {/* 提示条 */}
        <div className="border-b border-[#e8eaed] bg-[#f8f9fa] px-5 py-1.5 text-xs text-[#5f6368]">
          提示：拖拽表头右侧边缘调整<strong>列宽</strong>，拖拽行号底部边缘调整
          <strong>行高</strong>。
        </div>
        {/* 表格区 */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto"
          style={{ minHeight: 0 }}
        >
          {loading && (
            <div className="flex h-64 items-center justify-center text-sm text-[#5f6368]">
              <span className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-[#dadce0] border-t-[#1a73e8]" />
              正在读取数据…
            </div>
          )}
          {error && (
            <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-[#d93025]">
              {error}
            </div>
          )}
          {!loading && !error && data && (
            <table className="border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-[#dadce0] bg-[#f1f3f4] px-2 text-center text-xs font-medium text-[#5f6368]">
                    #
                  </th>
                  {columns.map((col, ci) => (
                    <th
                      key={ci}
                      className="relative select-none border-b border-r border-[#dadce0] bg-[#f1f3f4] px-3 py-2 text-left font-medium text-[#202124]"
                      style={{ width: colWidths[ci] ?? DEFAULT_COL_WIDTH }}
                    >
                      <span className="block truncate">{col}</span>
                      <span
                        onPointerDown={(e) => handleColResizeStart(e, ci)}
                        className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize ${
                          activeResize === `col-${ci}`
                            ? "bg-[#1a73e8]"
                            : "bg-transparent hover:bg-[#1a73e8]/40"
                        }`}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const h = rowHeights[ri] ?? DEFAULT_ROW_HEIGHT;
                  return (
                    <tr key={ri}>
                      <td
                        className="relative sticky left-0 z-10 select-none border-b border-r border-[#e8eaed] bg-[#f8f9fa] px-2 text-center text-xs text-[#9aa0a6]"
                        style={{ height: h }}
                      >
                        <span className="block">{ri + 1}</span>
                        <span
                          onPointerDown={(e) => handleRowResizeStart(e, ri)}
                          className={`absolute bottom-0 left-0 h-1.5 w-full cursor-row-resize ${
                            activeResize === `row-${ri}`
                              ? "bg-[#1a73e8]"
                              : "bg-transparent hover:bg-[#1a73e8]/40"
                          }`}
                        />
                      </td>
                      {columns.map((_, ci) => {
                        const v = row[ci] ?? "";
                        return (
                          <td
                            key={ci}
                            className="overflow-hidden border-b border-r border-[#e8eaed] px-3 text-[#202124]"
                            style={{
                              width: colWidths[ci] ?? DEFAULT_COL_WIDTH,
                              maxWidth: colWidths[ci] ?? DEFAULT_COL_WIDTH,
                              height: h,
                            }}
                          >
                            <div className="truncate" title={v}>
                              {v}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      className="px-4 py-10 text-center text-sm text-[#9aa0a6]"
                    >
                      该表无数据行
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-[#dadce0] px-5 py-3">
          <span className="text-xs text-[#9aa0a6]">
            预览为清洗后的数据（已忽略 Change Log、剔除空列）
          </span>
          <button
            onClick={onClose}
            className="rounded-full bg-[#1a73e8] px-5 py-1.5 text-sm font-medium text-white transition hover:bg-[#1765cc]"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}