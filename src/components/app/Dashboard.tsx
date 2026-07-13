"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";

interface CurrentInv {
  resourceId: string | null;
  originalName: string;
  rowCount: number;
  updatedAt: string | null;
  effectiveDate: string | null;
}
interface RealtimeSummary {
  baseQtyTotal: number;
  reservedQtyTotal: number;
  materialCount: number;
  shortageCount: number;
  reservedJobCount: number;
  skippedJobCount: number;
  current: CurrentInv | null;
}
interface OccupiedJob {
  id: string;
  name: string;
  sets: number;
  bizKey?: string | null;
  deductionStatus: string | null;
}

function fmtDateTime(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return s;
  }
}

type UploadKind = "inventory" | "occupied";

export default function Dashboard() {
  const [summary, setSummary] = useState<RealtimeSummary | null>(null);
  const [occupied, setOccupied] = useState<OccupiedJob[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [busy, setBusy] = useState<UploadKind | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [occSets, setOccSets] = useState("");
  const fileRefs = useRef<Record<UploadKind, HTMLInputElement | null>>({
    inventory: null,
    occupied: null,
  });

  const refresh = useCallback(async () => {
    try {
      const [rtRes, jobsRes] = await Promise.all([
        fetch("/api/inventory/realtime", { cache: "no-store" }),
        fetch("/api/bom/jobs?job_type=occupied_bom", { cache: "no-store" }),
      ]);
      if (rtRes.ok) setSummary((await rtRes.json()) as RealtimeSummary);
      if (jobsRes.ok) {
        const j = await jobsRes.json();
        const list: OccupiedJob[] = j.jobs ?? [];
        setOccupied(list);
        setActiveCount(list.filter((x) => (x.deductionStatus ?? "active") === "active").length);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // 首次加载
  if (summary === null && !busy) {
    refresh();
  }

  function flash(ok: boolean, msg: string) {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleUpload(kind: UploadKind, file: File) {
    setBusy(kind);
    try {
      const fd = new FormData();
      fd.append("files", file);
      if (kind === "inventory") {
        const res = await fetch("/api/inventory/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) return flash(false, data.error || "上传失败");
        flash(true, `库存表已设为 current，共解析 ${data.rows} 条物料`);
      } else {
        fd.append("job_type", "occupied_bom");
        if (occSets) fd.append("sets", occSets);
        const res = await fetch("/api/bom/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) return flash(false, data.error || "上传失败");
        if (data.duplicate) {
          return flash(false, data.message || "检测到重复文件，未纳入预扣减");
        }
        const extra = data.replacedExistingId ? "（已替换旧版本）" : "";
        flash(true, `occupied BOM 已上传并参与预扣减，生成 ${data.demandCount ?? 0} 条需求${extra}`);
      }
      await refresh();
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(null);
    }
  }

  function onPick(kind: UploadKind) {
    fileRefs.current[kind]?.click();
  }
  function onChange(kind: UploadKind, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleUpload(kind, f);
    e.target.value = "";
  }

  return (
    <div className="mx-auto w-[90%] max-w-[1800px] py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-normal text-[#202124]">BOM 库存预扣减 · 实时可用库存</h1>
        <p className="mt-1 text-sm text-[#5f6368]">
          上传库存表与 BOM，系统按「全局 active occupied BOM」预扣减计算实时可用库存。
        </p>
      </div>

      {toast && (
        <div
          className={`mb-4 rounded-md border px-4 py-2.5 text-sm ${
            toast.ok
              ? "border-[#a5d6a7] bg-[#e8f5e9] text-[#1b5e20]"
              : "border-[#f5c6cb] bg-[#fff3f3] text-[#9C0006]"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* 概览卡片 */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="当前库存表"
          value={summary?.current ? summary.current.originalName || "已设置" : "未上传"}
          sub={summary?.current ? `${summary.current.rowCount} 行 · ${fmtDateTime(summary.current.updatedAt)}` : "请上传库存表"}
          color="#1a73e8"
        />
        <StatCard
          label="基线库存总量"
          value={summary ? summary.baseQtyTotal.toLocaleString("zh-CN") : "—"}
          sub="current inventory snapshot"
          color="#00897b"
        />
        <StatCard
          label="预扣减需求总量"
          value={summary ? summary.reservedQtyTotal.toLocaleString("zh-CN") : "—"}
          sub={`${activeCount} 个 active · ${summary?.reservedJobCount ?? 0} 参与扣减`}
          color="#f9a825"
        />
        <StatCard
          label="实时可用 · 欠料物料数"
          value={summary ? summary.materialCount.toLocaleString("zh-CN") : "—"}
          sub={`${summary?.shortageCount ?? 0} 种物料预扣减超出库存`}
          color={summary && summary.shortageCount > 0 ? "#d93025" : "#3c4043"}
        />
      </div>

      {/* 上传区 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UploadCard
          title="上传库存表（inventory）"
          desc="每日更新，上传后自动设为 current，旧表保留历史。"
          badge="current 唯一"
          color="#1a73e8"
          accept=".xlsx,.xlsm,.xls"
          busy={busy === "inventory"}
          onPick={() => onPick("inventory")}
          onDrop={(f) => handleUpload("inventory", f)}
        />
        <UploadCard
          title="上传 occupied BOM（参与扣减）"
          desc="默认 active 参与预扣减。内容重复自动去重，同 biz_key 支持版本替换。"
          badge="预扣减"
          color="#f9a825"
          accept=".xlsx,.xlsm,.xls"
          busy={busy === "occupied"}
          onPick={() => onPick("occupied")}
          onDrop={(f) => handleUpload("occupied", f)}
          extra={
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-[#5f6368]">生产套数（可选）:</span>
              <input
                value={occSets}
                onChange={(e) => setOccSets(e.target.value)}
                type="number"
                min={1}
                placeholder="自动检测"
                className="w-28 rounded border border-[#dadce0] px-2 py-1 text-xs outline-none focus:border-[#1a73e8]"
              />
            </div>
          }
        />
      </div>

      <input ref={(el) => { fileRefs.current.inventory = el; }} type="file" accept=".xlsx,.xlsm,.xls" hidden onChange={(e) => onChange("inventory", e)} />
      <input ref={(el) => { fileRefs.current.occupied = el; }} type="file" accept=".xlsx,.xlsm,.xls" hidden onChange={(e) => onChange("occupied", e)} />

      {/* 快捷入口 */}
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/inventory" className="rounded-md bg-[#1a73e8] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1765cc]">
          查看实时库存 →
        </Link>
        <Link href="/history" className="rounded-md border border-[#dadce0] px-4 py-2 text-sm font-medium text-[#3c4043] transition hover:bg-[#f1f3f4]">
          BOM 历史记录
        </Link>
      </div>

      {/* 最近 occupied BOM */}
      <div className="mt-8">
        <h2 className="mb-3 text-base font-medium text-[#202124]">最近上传的 occupied BOM</h2>
        <div className="overflow-hidden rounded-lg border border-[#dadce0]">
          <table className="w-full text-sm">
            <thead className="bg-[#f8f9fa] text-left text-[#5f6368]">
              <tr>
                <th className="px-4 py-2 font-medium">文件名</th>
                <th className="px-4 py-2 font-medium">套数</th>
                <th className="px-4 py-2 font-medium">状态</th>
                <th className="px-4 py-2 font-medium">biz_key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eee]">
              {occupied.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-[#9aa0a6]">暂无 occupied BOM，请上传</td></tr>
              )}
              {occupied.slice(0, 8).map((j) => (
                <tr key={j.id}>
                  <td className="px-4 py-2 text-[#202124]">{j.name}</td>
                  <td className="px-4 py-2 text-[#5f6368]">{j.sets ?? "—"}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={j.deductionStatus ?? "active"} />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[#5f6368]">{j.bizKey ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-lg border border-[#dadce0] bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-xs font-medium text-[#5f6368]">{label}</span>
      </div>
      <div className="mt-2 truncate text-lg font-medium text-[#202124]" title={value}>{value}</div>
      <div className="mt-1 truncate text-xs text-[#9aa0a6]">{sub}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "active 参与扣减", cls: "bg-[#e6f4ea] text-[#137333]" },
    inactive: { label: "inactive 已停用", cls: "bg-[#f1f3f4] text-[#5f6368]" },
    duplicate: { label: "duplicate 重复", cls: "bg-[#fef7e0] text-[#b06000]" },
    replaced: { label: "replaced 已替换", cls: "bg-[#fce8e6] text-[#c5221f]" },
  };
  const m = map[status] ?? { label: status, cls: "bg-[#f1f3f4] text-[#5f6368]" };
  return <span className={`rounded px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>;
}

function UploadCard({
  title, desc, badge, color, accept, busy, onPick, onDrop, extra,
}: {
  title: string; desc: string; badge: string; color: string; accept: string;
  busy: boolean; onPick: () => void; onDrop: (f: File) => void; extra?: React.ReactNode;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onDrop(f);
      }}
      className={`rounded-lg border-2 border-dashed bg-white p-5 transition ${
        drag ? "border-[#1a73e8] bg-[#f6fafe]" : "border-[#dadce0]"
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-[#202124]">{title}</span>
        <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ background: `${color}1a`, color }}>
          {badge}
        </span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-[#5f6368]">{desc}</p>
      <button
        onClick={onPick}
        disabled={busy}
        className="w-full rounded-md px-3 py-2 text-sm font-medium text-white transition disabled:opacity-60"
        style={{ background: color }}
      >
        {busy ? "处理中…" : "选择文件上传"}
      </button>
      {extra}
      <p className="mt-2 text-center text-xs text-[#9aa0a6]">或将文件拖拽到此区域 · {accept}</p>
    </div>
  );
}
