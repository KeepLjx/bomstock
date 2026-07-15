"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

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
interface MaterialDemandSource {
  jobId: string;
  jobName: string;
  bizKey: string | null;
  sets: number;
  requiredQty: number;
  sourceRowNo: number | null;
  sourceSheet: string | null;
  demandCount: number;
  skipped: boolean;
  deductionStatus: string | null;
  effective: boolean;
  uploadedBy: string | null;
  uploaderName: string | null;
  jobCreatedAt: string | null;
  reservedAt: string | null;
  fileOriginalName: string | null;
  duplicateOfJobId: string | null;
  replacedByJobId: string | null;
}
interface MaterialInventoryInfo {
  resourceId: string | null;
  resourceName: string;
  effectiveDate: string | null;
  updatedAt: string | null;
  rowCount: number;
  snapshotCount: number;
}
interface MaterialDetail {
  materialCode: string;
  materialName: string;
  spec: string;
  baseQty: number;
  totalDemand: number;
  grossDemand: number;
  availableQty: number;
  shortage: number;
  inventory: MaterialInventoryInfo;
  sourceCount: number;
  sources: MaterialDemandSource[];
}

// 列定义：四列数值列起始宽度保持一致；表格整体铺满容器（w-full）后按比例分配剩余空间
const COLS: { key: string; label: string; w: number; align?: "right" }[] = [
  { key: "code", label: "物料编码", w: 260 },
  { key: "name", label: "名称 / 规格", w: 320 },
  { key: "base", label: "基线库存", w: 160, align: "right" },
  { key: "reserved", label: "预扣减", w: 160, align: "right" },
  { key: "available", label: "可用库存", w: 160, align: "right" },
  { key: "shortage", label: "欠料", w: 160, align: "right" },
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

  // 「同步到全局」确认弹窗
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  // 物料编码点击详情（窗口中央弹窗，点击空白关闭）
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, MaterialDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

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

  // phase3 切换后清空明细缓存（重新计算「工单跳过」标记）
  useEffect(() => {
    setDetailCache({});
  }, [phase3]);

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

  /** 将左侧勾选状态同步为全局扣减状态（勾选→active，未勾选→inactive） */
  async function doSyncGlobal() {
    const updates = mgmt
      .filter((j) => {
        const s = j.deductionStatus ?? "active";
        return s === "active" || s === "inactive";
      })
      .map((j) => ({
        jobId: j.id,
        status: (selected.has(j.id) ? "active" : "inactive") as "active" | "inactive",
      }));
    setSyncBusy(true);
    try {
      const res = await fetch("/api/bom/sync-global", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const d = await res.json();
      if (!res.ok) return flash(false, d.error || "同步失败");
      flash(true, `已同步到全局，共更新 ${d.changed ?? 0} 个 occupied BOM 的扣减状态`);
      setSyncOpen(false);
      await refresh();
    } finally {
      setSyncBusy(false);
    }
  }

  /** 拉取某物料的来源明细（带缓存） */
  async function fetchDetail(code: string) {
    if (detailCache[code]) return;
    setDetailLoading(code);
    try {
      const res = await fetch(
        `/api/inventory/material-detail?code=${encodeURIComponent(code)}&phase3=${phase3 ? "true" : "false"}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const d = (await res.json()) as MaterialDetail;
        setDetailCache((prev) => ({ ...prev, [code]: d }));
      }
    } finally {
      setDetailLoading(null);
    }
  }

  /** 点击物料编码：在窗口中央打开详情弹窗 */
  function onCodeClick(code: string) {
    setDetailCode(code);
    fetchDetail(code);
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

  // 表格铺满容器：用百分比列宽（固定 table-layout），确保宽屏铺满且列起始宽度一致
  const IDX_WEIGHT = 50;
  const totalWeight = IDX_WEIGHT + colWidths.reduce((a, b) => a + b, 0);
  const pct = (w: number) => `${((w / totalWeight) * 100).toFixed(2)}%`;

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
          <div className="space-y-2 border-t border-[#eee] px-3 py-3">
            <button
              onClick={() => setSyncOpen(true)}
              disabled={mgmt.length === 0}
              className="w-full rounded-md border border-[#137333] bg-[#e6f4ea] px-3 py-2 text-sm font-medium text-[#137333] transition hover:bg-[#ceead6] disabled:opacity-50"
              title="将勾选状态写入全局扣减状态（勾选→启用，未勾选→停用）"
            >
              ⬆ 同步勾选到全局
            </button>
            <button
              onClick={runSimulation}
              disabled={loading}
              className="w-full rounded-md bg-[#1a73e8] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-60"
            >
              {loading ? "计算中…" : "模拟重新计算"}
            </button>
            <p className="text-center text-[10px] text-[#9aa0a6]">
              {simMode ? "当前为模拟结果（未改全局）" : "勾选→同步到全局，或模拟重新计算"}
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
            <table className="w-full border-separate border-spacing-0 text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: pct(IDX_WEIGHT) }} />
                {COLS.map((col, ci) => (
                  <col key={col.key} style={{ width: pct(colWidths[ci]) }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-[#dadce0] bg-[#f1f3f4] px-2 text-center text-xs font-medium text-[#5f6368]">#</th>
                  {COLS.map((col, ci) => (
                    <th
                      key={col.key}
                      className={`relative select-none border-b border-r border-[#dadce0] bg-[#f1f3f4] px-3 py-2 ${col.align === "right" ? "text-right" : "text-left"} font-medium text-[#202124]`}
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
                        <button
                          type="button"
                          onClick={() => onCodeClick(m.materialCode)}
                          title="点击查看该物料的来源与需求明细"
                          className="flex w-full items-center gap-1 text-left transition hover:text-[#1a73e8]"
                        >
                          <span className="truncate underline decoration-dotted underline-offset-2">{m.materialCode}</span>
                          <span className="shrink-0 text-[#1a73e8]/60">ℹ</span>
                        </button>
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

      {/* 「同步勾选到全局」确认弹窗 */}
      <ConfirmDialog
        open={syncOpen}
        title="同步勾选到全局"
        danger={false}
        busy={syncBusy}
        confirmText="确定同步"
        onCancel={() => setSyncOpen(false)}
        onConfirm={doSyncGlobal}
        message={
          <div>
            将把左侧勾选状态写入全局扣减状态：
            <ul className="mt-1.5 list-disc pl-5 text-[#5f6368]">
              <li>勾选的 occupied BOM → <b className="text-[#137333]">active（参与预扣减）</b></li>
              <li>未勾选的 occupied BOM → <b className="text-[#b06000]">inactive（停止扣减）</b></li>
            </ul>
            <div className="mt-2 text-[#c5221f]">该操作会立即影响实时可用库存的全局口径，是否确定？</div>
          </div>
        }
      />

      {/* 物料编码详情（点击在窗口中央展示，点击空白处关闭） */}
      <MaterialDetailModal
        code={detailCode}
        detail={detailCode ? detailCache[detailCode] : undefined}
        loading={detailCode ? detailLoading === detailCode : false}
        onClose={() => setDetailCode(null)}
      />
    </div>
  );
}

/** 物料详情：窗口居中弹窗，点击遮罩（空白处）关闭 */
function MaterialDetailModal({
  code,
  detail,
  loading,
  onClose,
}: {
  code: string | null;
  detail: MaterialDetail | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!code) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [code, onClose]);

  if (!code) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-[#eee] px-4 py-3">
          <div className="min-w-0">
            <div className="break-all font-mono text-sm font-semibold text-[#1a73e8]">{code}</div>
            <div className="mt-0.5 break-words text-xs text-[#5f6368]">
              {detail?.materialName || "（物料名称未知）"}
              {detail?.spec ? <span className="text-[#9aa0a6]"> · {detail.spec}</span> : null}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-2 shrink-0 rounded px-2 py-1 text-sm text-[#5f6368] transition hover:bg-[#f1f3f4]"
            title="关闭（点击空白处也可关闭）"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-xs">
          {!detail && loading && (
            <div className="py-8 text-center text-[#9aa0a6]">加载明细中…</div>
          )}
          {!detail && !loading && (
            <div className="py-8 text-center text-[#9aa0a6]">暂无明细</div>
          )}
          {detail && (
            <>
              {/* 库存口径概览 */}
              <div className="mb-2 grid grid-cols-2 gap-1.5">
                <KV k="基线库存" v={fmt(detail.baseQty)} />
                <KV k="计入扣减总量" v={fmt(detail.totalDemand)} warn={detail.totalDemand > 0} />
                <KV k="全部需求合计" v={fmt(detail.grossDemand)} />
                <KV
                  k="可用 / 欠料"
                  v={detail.shortage > 0 ? `${fmt(detail.availableQty)}（欠 ${fmt(detail.shortage)}）` : fmt(detail.availableQty)}
                  danger={detail.shortage > 0}
                />
              </div>

              {/* 当前库存表信息（联表 bom_resources） */}
              <SectionTitle>当前库存表来源</SectionTitle>
              <div className="mb-2 grid grid-cols-2 gap-1.5">
                <KV k="库存表文件" v={detail.inventory.resourceName || "未上传"} />
                <KV k="快照行数" v={String(detail.inventory.snapshotCount)} />
                <KV k="生效日期" v={detail.inventory.effectiveDate || "—"} />
                <KV k="更新时间" v={fmtDateTime(detail.inventory.updatedAt)} />
              </div>

              {/* 来源明细 */}
              <SectionTitle>
                来自的 occupied BOM（{detail.sourceCount} · 需求明细 {detail.sources.reduce((n, s) => n + s.demandCount, 0)} 行）
              </SectionTitle>
              {detail.sources.length === 0 ? (
                <div className="py-2 text-center text-[11px] text-[#9aa0a6]">无任何 occupied BOM 引用该物料</div>
              ) : (
                <div className="space-y-1.5 pb-1">
                  {detail.sources.map((s) => (
                    <div
                      key={s.jobId}
                      className={`rounded border px-2.5 py-2 ${
                        s.effective ? "border-[#c6e7d0] bg-[#f6fef9]" : "border-[#eee] bg-[#fafafa]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="break-all font-medium text-[#202124]">{s.jobName || s.jobId.slice(0, 10)}</span>
                        <span className="shrink-0 font-semibold text-[#b06000]">需求 {fmt(s.requiredQty)}</span>
                      </div>
                      {s.fileOriginalName && s.fileOriginalName !== s.jobName && (
                        <div className="mt-0.5 break-all text-[10px] text-[#9aa0a6]">📄 {s.fileOriginalName}</div>
                      )}
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-[#5f6368]">
                        <Meta label="套数" value={String(s.sets)} />
                        <Meta label="需求行数" value={String(s.demandCount)} />
                        <Meta label="来源行号" value={s.sourceRowNo != null ? String(s.sourceRowNo) : "—"} />
                        <Meta label="来源 sheet" value={s.sourceSheet || "—"} />
                        <Meta label="上传者" value={s.uploaderName || "—"} />
                        <Meta label="上传时间" value={fmtDateTime(s.jobCreatedAt)} />
                        <Meta label="预留时间" value={fmtDateTime(s.reservedAt)} />
                        <Meta label="biz_key" value={s.bizKey || "—"} mono />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
                        <SourceTag effective={s.effective} skipped={s.skipped} status={s.deductionStatus ?? "active"} />
                        {s.duplicateOfJobId && (
                          <span className="rounded bg-[#fef7e0] px-1 text-[#b06000]">重复自 {s.duplicateOfJobId.slice(0, 10)}</span>
                        )}
                        {s.replacedByJobId && (
                          <span className="rounded bg-[#fce8e6] px-1 text-[#c5221f]">已被 {s.replacedByJobId.slice(0, 10)} 替换</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-1 text-[10px] text-[#9aa0a6]">点击空白处或 ✕ 关闭</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KV({ k, v, warn, danger }: { k: string; v: string; warn?: boolean; danger?: boolean }) {
  return (
    <div className="rounded border border-[#eee] bg-[#f8f9fa] px-2 py-1">
      <div className="text-[10px] text-[#5f6368]">{k}</div>
      <div className={`font-medium ${danger ? "text-[#c5221f]" : warn ? "text-[#b06000]" : "text-[#202124]"}`}>{v}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-2 border-b border-dashed border-[#eee] pb-1 text-[11px] font-semibold text-[#202124]">
      {children}
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="shrink-0 text-[#9aa0a6]">{label}:</span>
      <span className={`min-w-0 break-all ${mono ? "font-mono" : ""} text-[#3c4043]`} title={value}>{value}</span>
    </div>
  );
}

function SourceTag({ effective, skipped, status }: { effective: boolean; skipped: boolean; status: string }) {
  if (effective) return <span className="rounded bg-[#e6f4ea] px-1 text-[#137333]">计入扣减</span>;
  if (skipped) return <span className="rounded bg-[#fef7e0] px-1 text-[#b06000]">工单跳过</span>;
  if (status === "inactive") return <span className="rounded bg-[#f1f3f4] px-1 text-[#5f6368]">已停用</span>;
  return <span className="rounded bg-[#f1f3f4] px-1 text-[#5f6368]">{status}</span>;
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
