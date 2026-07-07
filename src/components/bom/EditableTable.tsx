"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import type {
  TableDataDTO,
  OutputRowDTO,
  CellDataDTO,
} from "./types";
import { downloadFile } from "@/lib/bom/client-download";

interface Props {
  jobId: string;
  table: TableDataDTO;
  baseName: string;
  outputFileName: string;
  summary: {
    shortageCount: number;
    blueCount: number;
    greenCount: number;
    totalRows: number;
    skippedBoms?: string[];
    deductionBomCount?: number;
  };
  onRestart: () => void;
}

type SelKey = string;
const k = (r: number, c: number): SelKey => `${r}:${c}`;

export default function EditableTable({
  jobId,
  table,
  baseName,
  outputFileName,
  summary,
  onRestart,
}: Props) {
  // 可编辑数据副本
  const [rows, setRows] = useState<OutputRowDTO[]>(() =>
    table.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) })),
  );
  // 选择：anchor + selected set
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<Set<SelKey>>(new Set());
  // 筛选
  const [query, setQuery] = useState("");
  const [filterSupply, setFilterSupply] = useState("all");
  const [colFilters, setColFilters] = useState<Record<number, Set<string>>>({});
  const [filterCol, setFilterCol] = useState<number | null>(null);
  // 工具
  const [fontColor, setFontColor] = useState("#d93025");
  const [fillColor, setFillColor] = useState("#fff2cc");
  const [fillValue, setFillValue] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [edited, setEdited] = useState(0);

  // 动态列宽/行高 —— 用数组存储，避免对象 key 强制转换问题
  const computeDefaultWidths = (cols: TableDataDTO["columns"]): number[] =>
    cols.map((c) => {
      if (c.kind === "analysis") return c.name === "库存状态" ? 200 : 100;
      if (c.kind === "jzd") return 90;
      return 150;
    });
  const [colWidths, setColWidths] = useState<number[]>(() => computeDefaultWidths(table.columns));
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({});
  const [activeResize, setActiveResize] = useState<string | null>(null);

  // ---- 列宽调整：在 pointerdown 中同步注册监听器（零时序问题） ----
  const handleColResizeStart = (e: React.PointerEvent, ci: number) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[ci] ?? 150;
    setActiveResize(`col-${ci}`);

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const newW = Math.max(50, Math.round(startW + delta));
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
    const startH = rowHeights[ri] ?? 32;
    setActiveResize(`row-${ri}`);

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientY - startY;
      const newH = Math.max(24, Math.round(startH + delta));
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

  // 关闭筛选下拉（点击外部）
  useEffect(() => {
    if (filterCol === null) return;
    const close = () => setFilterCol(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [filterCol]);

  const cols = table.columns;
  const supplyCol = table.supplyCol;

  // 每列的去重值（用于筛选下拉）
  const colDistinct = useMemo(() => {
    const m: Record<number, string[]> = {};
    cols.forEach((_, ci) => {
      const set = new Set<string>();
      for (const r of rows) {
        const v = r.cells[ci]?.v ?? "";
        if (v !== "") set.add(v);
      }
      m[ci] = [...set].slice(0, 200);
    });
    return m;
  }, [rows, cols]);

  // 过滤后的行索引
  const filteredIdx = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: number[] = [];
    rows.forEach((r, i) => {
      const supply = supplyCol >= 0 ? r.cells[supplyCol]?.v ?? "" : "";
      if (filterSupply !== "all") {
        if (filterSupply === "shortage" && r.highlight !== "red") return;
        if (filterSupply === "warning" && r.highlight !== "blue") return;
        if (filterSupply === "yibo" && !supply.includes("一博供")) return;
        if (filterSupply === "kegong" && !supply.includes("上架库存")) return;
      }
      // 列筛选
      let passCol = true;
      for (const [cs, allowed] of Object.entries(colFilters)) {
        const ci = Number(cs);
        if (allowed.size > 0 && !allowed.has(r.cells[ci]?.v ?? "")) {
          passCol = false;
          break;
        }
      }
      if (!passCol) return;
      if (q) {
        const hit = r.cells.some((c) => String(c?.v ?? "").toLowerCase().includes(q));
        if (!hit) return;
      }
      out.push(i);
    });
    return out;
  }, [rows, query, filterSupply, colFilters, supplyCol]);

  // ---- 选择 ----
  const handleSelect = useCallback(
    (r: number, c: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.shiftKey && anchor) {
        const [r0, c0] = anchor;
        const r1 = Math.min(r0, r),
          r2 = Math.max(r0, r),
          c1 = Math.min(c0, c),
          c2 = Math.max(c0, c);
        const ns = new Set<SelKey>();
        for (let rr = r1; rr <= r2; rr++)
          for (let cc = c1; cc <= c2; cc++) ns.add(k(rr, cc));
        setSelected(ns);
      } else if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const ns = new Set(prev);
          const key = k(r, c);
          if (ns.has(key)) ns.delete(key);
          else ns.add(key);
          return ns;
        });
        setAnchor([r, c]);
      } else {
        setSelected(new Set([k(r, c)]));
        setAnchor([r, c]);
      }
    },
    [anchor],
  );

  const selectAll = useCallback(() => {
    const ns = new Set<SelKey>();
    filteredIdx.forEach((ri) => cols.forEach((_, ci) => ns.add(k(ri, ci))));
    setSelected(ns);
    setAnchor(null);
  }, [filteredIdx, cols]);

  const selectCol = useCallback(
    (ci: number) => {
      const ns = new Set<SelKey>();
      filteredIdx.forEach((ri) => ns.add(k(ri, ci)));
      setSelected(ns);
      setAnchor(null);
    },
    [filteredIdx],
  );

  const selectRow = useCallback((ri: number) => {
    const ns = new Set<SelKey>();
    cols.forEach((_, ci) => ns.add(k(ri, ci)));
    setSelected(ns);
    setAnchor(null);
  }, [cols]);

  // ---- 编辑 ----
  const markEdited = useCallback(() => setEdited((n) => n + 1), []);

  const setCellValue = useCallback(
    (r: number, c: number, v: string) => {
      setRows((prev) => {
        const next = prev.slice();
        const row = { ...next[r], cells: next[r].cells.slice() };
        row.cells[c] = { ...row.cells[c], v };
        next[r] = row;
        return next;
      });
      markEdited();
    },
    [markEdited],
  );

  // 对选中单元格应用样式
  const applyToSelected = useCallback(
    (patch: Partial<CellDataDTO>) => {
      if (selected.size === 0) return;
      setRows((prev) => {
        const next = prev.slice();
        const touched = new Set<number>();
        for (const key of selected) {
          const [r, c] = key.split(":").map(Number);
          if (!touched.has(r)) {
            next[r] = { ...next[r], cells: next[r].cells.slice() };
            touched.add(r);
          }
          next[r].cells[c] = { ...next[r].cells[c], ...patch };
        }
        return next;
      });
      markEdited();
    },
    [selected, markEdited],
  );

  const toggleBold = useCallback(
    () => {
      // 取选中第一个的 bold 决定切换方向
      const first = selected.values().next().value;
      const [fr, fc] = first ? first.split(":").map(Number) : [0, 0];
      const cur = rows[fr]?.cells[fc]?.b ?? false;
      applyToSelected({ b: !cur });
    },
    [selected, rows, applyToSelected],
  );

  const batchFill = useCallback(() => {
    if (selected.size === 0 || fillValue === "") return;
    applyToSelected({ v: fillValue });
  }, [selected, fillValue, applyToSelected]);

  const clearFormat = useCallback(() => {
    applyToSelected({ fc: undefined, bc: undefined, b: undefined });
  }, [applyToSelected]);

  // ---- 列筛选 ----
  const toggleColFilter = (ci: number, val: string) => {
    setColFilters((prev) => {
      const next = { ...prev };
      const set = new Set(next[ci] ?? []);
      if (set.has(val)) set.delete(val);
      else set.add(val);
      next[ci] = set;
      return next;
    });
  };

  // ---- 导出 ----
  const handleExport = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const exportTable = { ...table, rows };
      const res = await fetch("/api/bom/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          table: exportTable,
          outputFileName,
          baseName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "导出失败");
        return;
      }
      await downloadFile(
        `/api/bom/download?jobId=${jobId}&file=${encodeURIComponent(data.outputFileName)}`,
        data.outputFileName,
      );
    } catch (e) {
      alert(`导出失败：${(e as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }, [downloading, rows, table, jobId, outputFileName, baseName]);

  const hasSel = selected.size > 0;
  const activeFilters = Object.values(colFilters).filter((s) => s.size > 0).length;

  const stats = [
    { label: "物料行", value: summary.totalRows, color: "#202124" },
    { label: "欠料", value: summary.shortageCount, color: "#d93025" },
    { label: "提醒", value: summary.blueCount, color: "#4472C4" },
    { label: "一博", value: summary.greenCount, color: "#00b050" },
  ];

  return (
    <div className="space-y-3" onClick={() => filterCol !== null && setFilterCol(null)}>
      {/* 统计 + 操作 */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[#dadce0] bg-[#f8f9fa] px-4 py-2.5">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline gap-1">
            <span className="text-base font-medium" style={{ color: s.color }}>{s.value}</span>
            <span className="text-xs text-[#5f6368]">{s.label}</span>
          </div>
        ))}
        {summary.deductionBomCount !== undefined && summary.deductionBomCount > 0 && (
          <div className="flex items-baseline gap-1">
            <span className="text-base font-medium text-[#5f6368]">{summary.deductionBomCount}</span>
            <span className="text-xs text-[#5f6368]">BOM参与扣减</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {edited > 0 && (
            <span className="text-xs text-[#1a73e8]">已改 {edited} 处</span>
          )}
          <button
            onClick={handleExport}
            disabled={downloading}
            className="flex items-center gap-1.5 rounded-full bg-[#1a73e8] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-60"
          >
            {downloading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : "⬇"}
            下载 XLSX
          </button>
          <button
            onClick={onRestart}
            className="rounded-full border border-[#dadce0] bg-white px-3 py-1.5 text-sm font-medium text-[#3c4043] transition hover:bg-[#f1f3f4]"
          >
            新任务
          </button>
        </div>
      </div>

      {/* 工单跳过提示 */}
      {summary.skippedBoms && summary.skippedBoms.length > 0 && (
        <div className="rounded-lg border border-[#e8f0fe] bg-[#e8f0fe] px-4 py-2 text-xs text-[#174ea6]">
          ✓ 工单确认已跳过 {summary.skippedBoms.length} 个 BOM 的扣减：
          {summary.skippedBoms.map((b, i) => (
            <span key={i} className="ml-1 rounded bg-white/70 px-1.5 py-0.5 font-medium">{b}</span>
          ))}
        </div>
      )}

      {/* 编辑工具栏 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#dadce0] bg-white px-3 py-2">
        <span className="text-xs font-medium text-[#5f6368]">
          {hasSel ? `已选 ${selected.size} 格` : "点击单元格选择"}
        </span>
        <div className="mx-1 h-5 w-px bg-[#dadce0]" />
        {/* 字体色 */}
        <label className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs text-[#3c4043] hover:bg-[#f1f3f4]" title="字体颜色">
          <span className="font-medium">A</span>
          <span className="h-4 w-4 rounded border border-[#dadce0]" style={{ background: fontColor }} />
          <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} className="sr-only" />
          <button
            disabled={!hasSel}
            onClick={() => applyToSelected({ fc: fontColor })}
            className="ml-1 rounded bg-[#e8f0fe] px-1.5 py-0.5 text-[10px] text-[#1a73e8] disabled:opacity-40"
          >应用</button>
        </label>
        {/* 背景色 */}
        <label className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs text-[#3c4043] hover:bg-[#f1f3f4]" title="单元格背景色">
          <span>🪣</span>
          <span className="h-4 w-4 rounded border border-[#dadce0]" style={{ background: fillColor }} />
          <input type="color" value={fillColor} onChange={(e) => setFillColor(e.target.value)} className="sr-only" />
          <button
            disabled={!hasSel}
            onClick={() => applyToSelected({ bc: fillColor })}
            className="ml-1 rounded bg-[#e8f0fe] px-1.5 py-0.5 text-[10px] text-[#1a73e8] disabled:opacity-40"
          >应用</button>
        </label>
        {/* 加粗 */}
        <button
          disabled={!hasSel}
          onClick={toggleBold}
          className="rounded px-2 py-1 text-sm font-bold text-[#3c4043] hover:bg-[#f1f3f4] disabled:opacity-40"
          title="加粗"
        >B</button>
        {/* 清除格式 */}
        <button
          disabled={!hasSel}
          onClick={clearFormat}
          className="rounded px-2 py-1 text-xs text-[#5f6368] hover:bg-[#f1f3f4] disabled:opacity-40"
          title="清除选中格式"
        >清除格式</button>
        <div className="mx-1 h-5 w-px bg-[#dadce0]" />
        {/* 批量填充 */}
        <input
          value={fillValue}
          onChange={(e) => setFillValue(e.target.value)}
          placeholder="批量填充值…"
          className="w-32 rounded border border-[#dadce0] px-2 py-1 text-xs outline-none focus:border-[#1a73e8]"
        />
        <button
          disabled={!hasSel || !fillValue}
          onClick={batchFill}
          className="rounded bg-[#1a73e8] px-2 py-1 text-xs font-medium text-white disabled:bg-[#dadce0]"
          title="将此值填入选中的所有单元格"
        >填充选中</button>
        <div className="mx-1 h-5 w-px bg-[#dadce0]" />
        <button onClick={selectAll} className="rounded px-2 py-1 text-xs text-[#1a73e8] hover:bg-[#f1f3f4]">全选可见</button>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9aa0a6] text-xs">🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索…"
            className="w-40 rounded-full border border-[#dadce0] bg-white py-1 pl-7 pr-3 text-xs outline-none focus:border-[#1a73e8]"
          />
        </div>
        <select
          value={filterSupply}
          onChange={(e) => setFilterSupply(e.target.value)}
          className="rounded-full border border-[#dadce0] bg-white px-2.5 py-1 text-xs outline-none focus:border-[#1a73e8]"
        >
          <option value="all">全部供料</option>
          <option value="shortage">仅欠料(红)</option>
          <option value="warning">仅提醒(蓝)</option>
          <option value="yibo">仅一博供</option>
          <option value="kegong">仅客供上架</option>
        </select>
        {activeFilters > 0 && (
          <button
            onClick={() => setColFilters({})}
            className="rounded-full bg-[#fce8e6] px-2.5 py-1 text-xs text-[#c5221f] hover:bg-[#fad2cf]"
          >
            清除列筛选({activeFilters})
          </button>
        )}
        <span className="text-xs text-[#9aa0a6]">显示 {filteredIdx.length}/{rows.length} 行</span>
        <span className="ml-auto text-xs text-[#9aa0a6]">▼ 筛选列 · 拖列/行边框调整宽高 · Shift/Ctrl 多选 · 工具栏作用于选中格</span>
      </div>

      {/* 表格 —— table-layout:fixed + border-spacing:0（避免 border-collapse 与 fixed 布局的冲突） */}
      <div className="overflow-hidden rounded-lg border border-[#dadce0]">
        <div className="g-scroll max-h-[58vh] overflow-auto">
          <table
            className="text-[13px]"
            style={{ tableLayout: "fixed", borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}
          >
            <colgroup>
              <col style={{ width: 44 }} />
              {cols.map((_, ci) => (
                <col key={ci} style={{ width: colWidths[ci] ?? 150 }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  className="sticky left-0 z-30 w-11 cursor-pointer border-b border-r border-[#dadce0] bg-[#f8f9fa] px-1 py-1.5 text-center text-xs text-[#5f6368] hover:bg-[#f1f3f4]"
                  onClick={selectAll}
                  title="全选可见"
                >#</th>
                {cols.map((c, ci) => (
                  <th
                    key={ci}
                    className="border-b border-r border-[#e1e3e6] px-0 py-0 text-center text-xs font-medium last:border-r-0"
                    style={{
                      background: c.kind === "orig" ? "#f8f9fa" : "#e8f0fe",
                      color: c.kind === "orig" ? "#5f6368" : "#174ea6",
                    }}
                  >
                    {/* 用 relative div 包裹内容 —— th 上的 position:relative 在部分浏览器不可靠 */}
                    <div className="relative flex items-center justify-center gap-0.5 px-2 py-1.5">
                      <span
                        className="cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap"
                        onClick={() => selectCol(ci)}
                        title={`${c.name}（点击选中整列）`}
                      >{c.name}</span>
                      <button
                        className="flex-shrink-0 text-[9px] text-[#9aa0a6] hover:text-[#1a73e8]"
                        onClick={(e) => { e.stopPropagation(); setFilterCol(filterCol === ci ? null : ci); }}
                        title="筛选"
                      >▼</button>
                      {filterCol === ci && (
                        <div
                          className="absolute left-0 top-full z-40 mt-0.5 max-h-60 w-44 overflow-auto rounded-md border border-[#dadce0] bg-white p-1.5 text-left shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="mb-1 flex justify-between text-[10px]">
                            <button className="text-[#1a73e8]" onClick={() => setColFilters((p) => ({ ...p, [ci]: new Set(colDistinct[ci]) }))}>全选</button>
                            <button className="text-[#5f6368]" onClick={() => setColFilters((p) => ({ ...p, [ci]: new Set() }))}>清除</button>
                          </div>
                          {(colFilters[ci]?.size ?? 0) > 0 && (
                            <div className="mb-1 text-[10px] text-[#1a73e8]">已选 {colFilters[ci].size}</div>
                          )}
                          {colDistinct[ci]?.map((v) => (
                            <label key={v} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[11px] text-[#3c4043] hover:bg-[#f1f3f4]">
                              <input
                                type="checkbox"
                                checked={colFilters[ci]?.has(v) ?? false}
                                onChange={() => toggleColFilter(ci, v)}
                                className="h-3 w-3"
                              />
                              <span className="truncate">{v}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      {/* 列宽调整手柄 —— 在 relative div 内，position:absolute 才能正确工作 */}
                      <div
                        className={`col-resizer ${activeResize === `col-${ci}` ? "active" : ""}`}
                        onPointerDown={(e) => handleColResizeStart(e, ci)}
                        title="拖拽调整列宽"
                      />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredIdx.map((ri, dn) => (
                <tr key={ri} className="group" style={rowHeights[ri] ? { height: rowHeights[ri] } : undefined}>
                  <td
                    className="sticky left-0 z-10 w-11 cursor-pointer border-b border-r border-[#e1e3e6] bg-[#f8f9fa] px-1 py-0 text-center text-[11px] text-[#9aa0a6] hover:bg-[#e8f0fe]"
                    onClick={() => selectRow(ri)}
                    title="选中整行"
                  >
                    <div className="relative py-1">
                      {dn + 1}
                      <div
                        className={`row-resizer ${activeResize === `row-${ri}` ? "active" : ""}`}
                        onPointerDown={(e) => handleRowResizeStart(e, ri)}
                        title="拖拽调整行高"
                      />
                    </div>
                  </td>
                  {cols.map((c, ci) => {
                    const cell = rows[ri].cells[ci] ?? { v: "" };
                    const isSel = selected.has(k(ri, ci));
                    const isNum = c.kind === "analysis" && /^(需求数量|库存总数量|扣减用量|可用库存)/.test(c.name);
                    return (
                      <td
                        key={ci}
                        onMouseDown={(e) => handleSelect(ri, ci, e)}
                        className="relative cursor-cell border-b border-r border-[#e1e3e6] p-0 last:border-r-0"
                        style={{
                          background: cell.bc ?? (isSel ? "#e8f0fe" : undefined),
                          outline: isSel ? "2px solid #1a73e8" : undefined,
                          outlineOffset: "-2px",
                        }}
                      >
                        <input
                          value={cell.v}
                          onChange={(e) => setCellValue(ri, ci, e.target.value)}
                          onFocus={() => { if (!selected.has(k(ri, ci))) { setSelected(new Set([k(ri, ci)])); setAnchor([ri, ci]); } }}
                          className="cell-input h-full w-full bg-transparent px-2 py-1 text-[13px] outline-none"
                          style={{
                            color: cell.fc,
                            textAlign: isNum ? "center" : "left",
                            fontWeight: cell.b ? 700 : c.kind === "analysis" ? 500 : undefined,
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filteredIdx.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 1} className="px-4 py-12 text-center text-sm text-[#9aa0a6]">
                    没有匹配的数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[#dadce0] px-4 py-2 text-xs text-[#5f6368]">
        <span className="font-medium text-[#3c4043]">图例</span>
        <Legend sw="#4472C4" text="蓝 · 库存刚好满足" dark />
        <Legend sw="#00b050" text="绿 · 一博供/问题待确认" dark />
        <Legend sw="#FFC7CE" text="红 · 欠料需增补" />
        <span className="ml-auto">导出的 XLSX 保留原始 BOM 字体/列宽/合并/空列样式</span>
      </div>
    </div>
  );
}

function Legend({ sw, text, dark }: { sw: string; text: string; dark?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded" style={{ background: sw }} />
      <span style={dark ? { color: sw, fontWeight: 500 } : undefined}>{text}</span>
    </span>
  );
}
