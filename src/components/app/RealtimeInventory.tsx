"use client";

import { useCallback, useEffect, useState } from "react";

interface Material {
  materialCode: string;
  materialName: string;
  spec: string;
  baseQty: number;
  reservedQty: number;
  availableQty: number;
  shortage: number;
}
interface RTJob {
  id: string;
  name: string;
  sets: number;
  bizKey: string | null;
  skipped: boolean;
  demandRows: number;
}
interface Result {
  current: {
    originalName: string;
    rowCount: number;
    updatedAt: string | null;
    effectiveDate: string | null;
  } | null;
  baseQtyTotal: number;
  reservedQtyTotal: number;
  materialCount: number;
  reservedJobCount: number;
  skippedJobCount: number;
  shortageCount: number;
  runPhase3: boolean;
  jobs: RTJob[];
  materials: Material[];
}
interface MgmtJob {
  id: string;
  name: string | null;
  sets: number | null;
  bizKey: string | null;
  deductionStatus: string | null;
  reservedAt: string | null;
}

const COLS: { key: string; label: string; w: number; align?: "right" }[] = [
  { key: "code", label: "物料编码", w: 220 },
  { key: "name", label: "名称 / 规格", w: 240 },
  { key: "base", label: "基线库存", w: 140, align: "right" },
  { key: "reserved", label: "预扣减", w: 140, align: "right" },
  { key: "available", label: "可用库存", w: 140, align: "right" },
  { key: "shortage", label: "欠料", w: 130, align: "right" },
];
const DEFAULT_ROW_H = 36;

function fmt(n: number): string {
  return Math.round(n * 100) / 100 + "";
}
function fmtDateTime(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return s;
  }
}

export default function RealtimeInventory() {
  const [data, setData] = useState<Result | null>(null);
  const [sim, setSim] = useState<Result | null>(null);
  const [mgmt, setMgmt] = useState<MgmtJob[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase3, setPhase3] = useState(true);
  const [simMode, setSimMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState("");
  const [onlyShortage, setOnlyShortage] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 可调列宽 / 行高
  const [colWidths, setColWidths] = useState<number[]>(COLS.map((c) => c.w));
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({});
  const [activeResize, setActiveResize] = useState<string | null>(null);

  const loadRealtime = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inventory/realtime", { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as Result;
        setData(d);
        setPhase3(d.runPhase3);
        setSelected(new Set(d.jobs.filter((j) => !j.skipped).map((j) => j.id)));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMgmt = useCallback(async () => {
    const res = await fetch("/api/bom/jobs?job_type=occupied_bom", { cache: "no-store" });
    if (res.ok) setMgmt(((await res.json()).jobs ?? []) as MgmtJob[]);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadRealtime(), loadMgmt()]);
  }, [loadRealtime, loadMgmt]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runSimulation() {
    setLoading(true);
    try {
      const res = await fetch("/api/bom/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: Array.from(selected), runPhase3: phase3 }),
      });
      if (res.ok) {
        setSimMode(true);
        setSim((await res.json()) as Result);
      }
    } finally {
      setLoading(false);
    }
  }

  function resetToGlobal() {
    setSimMode(false);
    setSim(null);
    if (data) setSelected(new Set(data.jobs.filter((j) => !j.skipped).map((j) => j.id)));
  }

  async function toggleDeduction(job: MgmtJob) {
    const next = (job.deductionStatus ?? "active") === "active" ? "inactive" : "active";
    setBusyId(job.id);
    try {
      const res = await fetch("/api/bom/toggle-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, status: next }),
      });
      const d = await res.json();
      if (!res.ok) return flash(false, d.error || "操作失败");
      flash(true, next === "active" ? `已启用「${job.name}」参与预扣减（全局生效）` : `已停用「${job.name}」扣减（全局生效）`);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function replaceVersion(job: MgmtJob) {
    if (!job.bizKey) return flash(false, "该 BOM 缺少 biz_key，无法替换");
    if (!confirm(`将「${job.name}」设为该 biz_key（${job.bizKey}）的当前版本？旧 active 版本会被标记为 replaced。`)) return;
    setBusyId(job.id);
    try {
      const res = await fetch("/api/bom/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const d = await res.json();
      if (!res.ok) return flash(false, d.error || "替换失败");
      flash(true, `已设为当前版本，旧版本 ${d.replacedIds?.length ?? 0} 个标记为 replaced（全局生效）`);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  // 导出（全局或模拟口径）
  async function doExport() {
    setExporting(true);
    try {
      const isSim = simMode;
      const res = isSim
        ? await fetch("/api/inventory/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobIds: Array.from(selected), runPhase3: phase3 }),
          })
        : await fetch(`/api/inventory/export?phase3=${phase3 ? "true" : "false"}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return flash(false, e.error || "导出失败");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${isSim ? "模拟" : "全局"}可用库存_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      flash(true, "已导出 Excel 文件");
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  // 列宽拖拽
  function handleColResizeStart(e: React.PointerEvent, ci: number) {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[ci];
    setActiveResize(`col-${ci}`);
    const onMove = (ev: PointerEvent) => {
      const newW = Math.max(60, Math.round(startW + ev.clientX - startX));
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
  // 行高拖拽
  function handleRowResizeStart(e: React.PointerEvent, ri: number) {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startH = rowHeights[ri] ?? DEFAULT_ROW_H;
    setActiveResize(`row-${ri}`);
    const onMove = (ev: PointerEvent) => {
      const newH = Math.max(24, Math.round(startH + ev.clientY - startY));
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
  }

  function resetSizes() {
    setColWidths(COLS.map((c) => c.w));
    setRowHeights({});
  }

  const display = simMode && sim ? sim : data;

  const filtered = (display?.materials ?? []).filter((m) => {
    if (onlyShortage && m.shortage <= 0) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return (
        m.materialCode.toLowerCase().includes(q) ||
        m.materialName.toLowerCase().includes(q) ||
        m.spec.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 标题栏 */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-[5%] pt-6 pb-3">
        <div>
          <h1 className="text-2xl font-normal text-[#202124]">实时可用库存</h1>
          <p className="mt-1 text-sm text-[#5f6368]">
            口径：实时可用 = current 库存 − Σ(active occupied BOM 需求，未跳过)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={doExport}
            disabled={exporting}
            className="rounded-md bg-[#1a73e8] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-60"
          >
            {exporting ? "导出中…" : "导出 Excel"}
          </button>
          <button
            onClick={refresh}
            className="rounded-md border border-[#dadce0] px-3 py-2 text-sm font-medium text-[#3c4043] transition hover:bg-[#f1f3f4]"
          >
            刷新
          </button>
          {simMode && (
            <button
              onClick={resetToGlobal}
              className="rounded-md border border-[#dadce0] px-3 py-2 text-sm font-medium text-[#3c4043] transition hover:bg-[#f1f3f4]"
            >
              返回全局口径
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={`mx-[5%] mb-2 rounded-md border px-4 py-2 text-sm ${msg.ok ? "border-[#a5d6a7] bg-[#e8f5e9] text-[#1b5e20]" : "border-[#f5c6cb] bg-[#fff3f3] text-[#9C0006]"}`}>
          {msg.text}
        </div>
      )}

      {/* 概览 */}
      <div className="mx-[5%] mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Mini label="当前库存表" value={display?.current?.originalName || "未上传"} />
        <Mini label="物料种类" value={String(display?.materialCount ?? 0)} />
        <Mini label="基线库存总量" value={(display?.baseQtyTotal ?? 0).toLocaleString("zh-CN")} />
        <Mini label="预扣减总量" value={(display?.reservedQtyTotal ?? 0).toLocaleString("zh-CN")} warn={(display?.reservedQtyTotal ?? 0) > 0} />
        <Mini label="欠料物料数" value={String(display?.shortageCount ?? 0)} danger={(display?.shortageCount ?? 0) > 0} />
      </div>

      {/* 主体：铺满剩余窗口 */}
      <div className="flex min-h-0 flex-1 gap-4 px-[5%] pb-6">
        {/* 左：occupied BOM 管理 */}
        <div className="flex w-[340px] shrink-0 flex-col rounded-lg border border-[#dadce0] bg-white">
          <div className="flex items-center justify-between border-b border-[#eee] px-4 py-3">
            <h2 className="text-sm font-medium text-[#202124]">occupied BOM 管理</h2>
            <span className="text-xs text-[#9aa0a6]">{mgmt.length} 个</span>
          </div>
          <div className="flex items-center justify-between border-b border-[#eee] bg-[#f8f9fa] px-3 py-2">
            <span className="text-xs text-[#5f6368]">阶段三 工单跳过</span>
            <button
              onClick={() => setPhase3((v) => !v)}
              className={`relative h-5 w-9 rounded-full transition ${phase3 ? "bg-[#1a73e8]" : "bg-[#dadce0]"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${phase3 ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-[#f0f0f0] overflow-auto">
            {mgmt.length === 0 && (
              <p className="py-6 text-center text-xs text-[#9aa0a6]">
                暂无 occupied BOM。
                <br />
                请在首页上传 occupied BOM 参与预扣减。
              </p>
            )}
            {mgmt.map((j) => {
              const status = j.deductionStatus ?? "active";
              const isActive = status === "active";
              const rt = data?.jobs.find((x) => x.id === j.id);
              return (
                <div key={j.id} className="px-3 py-2.5">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(j.id)}
                      onChange={() => toggle(j.id)}
                      className="mt-1 h-4 w-4 accent-[#1a73e8]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-[#202124]" title={j.name ?? ""}>{j.name}</span>
                      <span className="text-[10px] text-[#9aa0a6]">
                        套数 {j.sets ?? "—"} · {rt?.demandRows ?? 0} 需求{phase3 && rt?.skipped ? " · 工单跳过" : ""}
                      </span>
                    </span>
                  </label>
                  <div className="mt-1.5 flex items-center gap-1.5 pl-6">
                    <StatusPill status={status} />
                    <button
                      onClick={() => toggleDeduction(j)}
                      disabled={busyId === j.id || status === "replaced" || status === "duplicate"}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-40 ${
                        isActive ? "bg-[#fce8e6] text-[#c5221f] hover:bg-[#f9d0cc]" : "bg-[#e6f4ea] text-[#137333] hover:bg-[#ceead6]"
                      }`}
                    >
                      {isActive ? "停用扣减" : "启用扣减"}
                    </button>
                    <button
                      onClick={() => replaceVersion(j)}
                      disabled={busyId === j.id || !j.bizKey || isActive}
                      className="rounded bg-[#e8f0fe] px-2 py-0.5 text-[11px] font-medium text-[#1a73e8] transition hover:bg-[#d2e3fc] disabled:opacity-40"
                    >
                      替换
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-[#eee] px-3 py-3">
            <button
              onClick={runSimulation}
              disabled={loading}
              className="w-full rounded-md bg-[#1a73e8] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-60"
            >
              {loading ? "计算中…" : "模拟重新计算"}
            </button>
            <p className="mt-1.5 text-center text-[10px] text-[#9aa0a6]">
              {simMode ? "当前为模拟结果（未改全局）" : "勾选 BOM 后模拟；启停/替换直接改全局"}
            </p>
          </div>
        </div>

        {/* 右：物料表格（铺满 + 可调宽高） */}
        <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-[#dadce0] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eee] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜索编码 / 名称 / 规格"
                className="w-56 rounded-md border border-[#dadce0] px-3 py-1.5 text-sm outline-none focus:border-[#1a73e8]"
              />
              <label className="flex items-center gap-1.5 text-xs text-[#5f6368]">
                <input type="checkbox" checked={onlyShortage} onChange={(e) => setOnlyShortage(e.target.checked)} className="h-4 w-4 accent-[#1a73e8]" />
                仅看欠料
              </label>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#9aa0a6]">
                {simMode ? "🔵 模拟口径 · " : "全局口径 · "}
                库存表 {fmtDateTime(display?.current?.updatedAt ?? null)}
              </span>
              <button onClick={resetSizes} className="rounded-full border border-[#dadce0] px-2.5 py-1 text-xs font-medium text-[#3c4043] transition hover:bg-[#f1f3f4]">
                重置宽高
              </button>
            </div>
          </div>
          {/* 提示条 */}
          <div className="border-b border-[#eee] bg-[#f8f9fa] px-4 py-1 text-[11px] text-[#5f6368]">
            拖拽表头右侧边缘调整<strong>列宽</strong>，拖拽行号底部边缘调整<strong>行高</strong>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" style={{ minHeight: 0 }}>
            <table className="border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-[#dadce0] bg-[#f1f3f4] px-2 text-center text-xs font-medium text-[#5f6368]" style={{ width: 50 }}>#</th>
                  {COLS.map((col, ci) => (
                    <th
                      key={col.key}
                      className={`relative select-none border-b border-r border-[#dadce0] bg-[#f1f3f4] px-3 py-2 ${col.align === "right" ? "text-right" : "text-left"} font-medium text-[#202124]`}
                      style={{ width: colWidths[ci] }}
                    >
                      <span className="block truncate">{col.label}</span>
                      <span
                        onPointerDown={(e) => handleColResizeStart(e, ci)}
                        className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize ${activeResize === `col-${ci}` ? "bg-[#1a73e8]" : "bg-transparent hover:bg-[#1a73e8]/40"}`}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={COLS.length + 1} className="border-b border-r border-[#e8eaed] px-4 py-12 text-center text-sm text-[#9aa0a6]">
                      {loading ? "加载中…" : "无数据，请上传库存表与 occupied BOM"}
                    </td>
                  </tr>
                )}
                {filtered.map((m, i) => {
                  const short = m.shortage > 0;
                  const low = !short && m.reservedQty > 0 && m.availableQty < m.reservedQty;
                  const rowBg = short ? "#fff5f5" : low ? "#fffdf5" : "#ffffff";
                  const h = rowHeights[i] ?? DEFAULT_ROW_H;
                  return (
                    <tr key={m.materialCode}>
                      <td
                        className="relative sticky left-0 z-10 border-b border-r border-[#e8eaed] px-2 text-center text-xs text-[#9aa0a6]"
                        style={{ height: h, background: "#f8f9fa" }}
                      >
                        <span className="block">{i + 1}</span>
                        <span
                          onPointerDown={(e) => handleRowResizeStart(e, i)}
                          className={`absolute bottom-0 left-0 h-1.5 w-full cursor-row-resize ${activeResize === `row-${i}` ? "bg-[#1a73e8]" : "bg-transparent hover:bg-[#1a73e8]/40"}`}
                        />
                      </td>
                      <td className="overflow-hidden border-b border-r border-[#e8eaed] px-3 font-mono text-xs text-[#202124]" style={{ height: h, background: rowBg }}>
                        <div className="truncate" title={m.materialCode}>{m.materialCode}</div>
                      </td>
                      <td className="overflow-hidden border-b border-r border-[#e8eaed] px-3 text-[#3c4043]" style={{ height: h, background: rowBg }}>
                        <div className="truncate text-[#202124]" title={m.materialName}>{m.materialName || "—"}</div>
                        {m.spec && <div className="truncate text-xs text-[#9aa0a6]" title={m.spec}>{m.spec}</div>}
                      </td>
                      <td className="border-b border-r border-[#e8eaed] px-3 text-right text-[#3c4043]" style={{ height: h, background: rowBg }}>{fmt(m.baseQty)}</td>
                      <td className="border-b border-r border-[#e8eaed] px-3 text-right text-[#b06000]" style={{ height: h, background: rowBg }}>{fmt(m.reservedQty)}</td>
                      <td className={`border-b border-r border-[#e8eaed] px-3 text-right font-medium ${short ? "text-[#c5221f]" : low ? "text-[#b06000]" : "text-[#137333]"}`} style={{ height: h, background: rowBg }}>{fmt(m.availableQty)}</td>
                      <td className={`border-b border-r border-[#e8eaed] px-3 text-right font-medium ${short ? "text-[#c5221f]" : "text-[#9aa0a6]"}`} style={{ height: h, background: rowBg }}>{short ? fmt(m.shortage) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, danger, warn }: { label: string; value: string; danger?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-[#dadce0] bg-white p-3">
      <div className="text-xs text-[#5f6368]">{label}</div>
      <div className={`mt-1 truncate text-base font-medium ${danger ? "text-[#d93025]" : warn ? "text-[#b06000]" : "text-[#202124]"}`} title={value}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "active", cls: "bg-[#e6f4ea] text-[#137333]" },
    inactive: { label: "inactive", cls: "bg-[#f1f3f4] text-[#5f6368]" },
    duplicate: { label: "duplicate", cls: "bg-[#fef7e0] text-[#b06000]" },
    replaced: { label: "replaced", cls: "bg-[#fce8e6] text-[#c5221f]" },
  };
  const m = map[status] ?? { label: status, cls: "bg-[#f1f3f4] text-[#5f6368]" };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${m.cls}`}>{m.label}</span>;
}
