"use client";

import { useCallback, useEffect, useState } from "react";

interface LogEntry {
  id: string;
  userId: string | null;
  username: string | null;
  displayName: string | null;
  action: string;
  actionLabel: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  createdAt: number;
}

const ACTION_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "login", label: "登录/退出" },
  { key: "register", label: "注册" },
  { key: "upload", label: "上传" },
  { key: "replace", label: "替换" },
  { key: "toggle_active", label: "启停扣减" },
  { key: "recalculate", label: "模拟重算" },
  { key: "change_password", label: "改密" },
];

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "—";
  }
}

function detailSummary(action: string, detail: unknown): string {
  if (!detail || typeof detail !== "object") return "";
  const d = detail as Record<string, unknown>;
  if (action === "upload_inventory" && typeof d.rows === "number") return `${d.originalName ?? ""} · ${d.rows} 条物料`;
  if (action === "upload_occupied_bom") {
    if (d.duplicate) return `${d.originalName ?? ""} · 重复`;
    return `${d.originalName ?? ""} · ${typeof d.demands === "number" ? d.demands + " 需求" : ""}${d.replacedExistingId ? " · 替换旧版" : ""}`;
  }
  if (action === "toggle_active") return `${d.name ?? ""} → ${d.status}`;
  if (action === "replace") {
    const ids = Array.isArray(d.replacedIds) ? d.replacedIds : [];
    return `${d.bizKey ?? d.name ?? ""} · 替换 ${ids.length} 个旧版`;
  }
  if (action === "recalculate") {
    return `${typeof d.jobIds === "string" ? d.jobIds : "指定集合"} · ${typeof d.materialCount === "number" ? d.materialCount + " 物料" : ""}`;
  }
  if (action === "login" || action === "register") return d.username ? `@${d.username}` : "";
  return "";
}

export default function LogsView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/audit-logs?limit=300", { cache: "no-store" });
      if (res.ok) setLogs(((await res.json()).logs ?? []) as LogEntry[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = logs.filter((l) => {
    if (filter === "all") return true;
    if (filter === "login") return l.action === "login" || l.action === "logout";
    if (filter === "upload")
      return l.action.startsWith("upload") || l.action === "set_current_inventory";
    return l.action === filter;
  });

  return (
    <div className="mx-auto w-[90%] max-w-[1800px] py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-normal text-[#202124]">操作日志</h1>
          <p className="mt-1 text-sm text-[#5f6368]">全员操作记录追溯（谁在何时做了什么）。</p>
        </div>
        <button
          onClick={load}
          className="rounded-md border border-[#dadce0] px-3 py-2 text-sm font-medium text-[#3c4043] transition hover:bg-[#f1f3f4]"
        >
          刷新
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-[#dadce0] bg-white p-1">
        {ACTION_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              filter === f.key ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#5f6368] hover:bg-[#f1f3f4]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-[#dadce0] bg-white">
        <div className="overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[#f8f9fa] text-left text-[#5f6368]">
              <tr>
                <th className="px-4 py-3 font-medium">时间</th>
                <th className="px-4 py-3 font-medium">操作人</th>
                <th className="px-4 py-3 font-medium">操作</th>
                <th className="px-4 py-3 font-medium">详情</th>
                <th className="px-4 py-3 font-medium">目标</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {loading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-[#9aa0a6]">加载中…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-[#9aa0a6]">暂无日志</td></tr>
              )}
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-[#fcfcfd]">
                  <td className="whitespace-nowrap px-4 py-2.5 text-[#5f6368]">{fmtTime(l.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8f0fe] text-xs text-[#1a73e8]">
                        {(l.displayName || l.username || "?").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="text-[#202124]">{l.displayName || l.username || "—"}</span>
                      {l.username && <span className="text-xs text-[#9aa0a6]">@{l.username}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <ActionTag action={l.action} label={l.actionLabel} />
                  </td>
                  <td className="px-4 py-2.5 text-[#5f6368]">{detailSummary(l.action, l.detail) || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[#9aa0a6]">
                    {l.targetType ? `${l.targetType}/` : ""}{l.targetId ? l.targetId.slice(0, 12) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ActionTag({ action, label }: { action: string; label: string }) {
  const map: Record<string, string> = {
    login: "bg-[#e8f0fe] text-[#1a73e8]",
    logout: "bg-[#f1f3f4] text-[#5f6368]",
    register: "bg-[#e6f4ea] text-[#137333]",
    change_password: "bg-[#fef7e0] text-[#b06000]",
    upload_inventory: "bg-[#e6f4ea] text-[#137333]",
    upload_work_order: "bg-[#e6f4ea] text-[#137333]",
    upload_occupied_bom: "bg-[#fef7e0] text-[#b06000]",
    upload_target_bom: "bg-[#e8f0fe] text-[#1a73e8]",
    toggle_active: "bg-[#fce8e6] text-[#c5221f]",
    replace: "bg-[#fce8e6] text-[#c5221f]",
    recalculate: "bg-[#f3e8fd] text-[#8430ce]",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[action] ?? "bg-[#f1f3f4] text-[#5f6368]"}`}>{label}</span>;
}
