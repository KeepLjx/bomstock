"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ResultPreviewModal from "./ResultPreviewModal";
import ConfirmDialog from "./ConfirmDialog";
import { apiFetch } from "@/lib/api-client";

interface JobFile {
  originalName: string;
  kind: string;
  role?: string;
}
interface Job {
  id: string;
  name: string | null;
  status: string;
  jobType: string | null;
  uploadedBy: string | null;
  bizKey: string | null;
  sets: number | null;
  deductionStatus: string | null;
  duplicateOfJobId: string | null;
  replacedByJobId: string | null;
  reservedAt: string | null;
  createdAt: number;
  outputFileName: string | null;
  files: JobFile[];
  error: string | null;
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "—";
  }
}

export default function History() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<"all" | "occupied_bom" | "target_bom" | "workflow">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewJob, setPreviewJob] = useState<{ id: string; name: string } | null>(null);
  const [delTarget, setDelTarget] = useState<Job | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/bom/jobs", { cache: "no-store" });
    if (res.ok) setJobs(((await res.json()).jobs ?? []) as Job[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 3500);
  }

  async function toggle(job: Job) {
    const next = (job.deductionStatus ?? "active") === "active" ? "inactive" : "active";
    setBusy(job.id);
    try {
      const res = await apiFetch("/api/bom/toggle-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, status: next }),
      });
      const data = await res.json();
      if (!res.ok) return flash(false, data.error || "操作失败");
      flash(true, next === "active" ? "已启用参与预扣减" : "已停用扣减");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function replace(job: Job) {
    if (!confirm(`将「${job.name}」设为该 biz_key 的当前版本？旧 active 版本会被标记为 replaced。`)) return;
    setBusy(job.id);
    try {
      const res = await apiFetch("/api/bom/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (!res.ok) return flash(false, data.error || "替换失败");
      flash(true, `已替换，旧版本 ${data.replacedIds?.length ?? 0} 个标记为 replaced`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(job: Job) {
    setDelBusy(true);
    try {
      const res = await apiFetch("/api/bom/delete-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (!res.ok) return flash(false, data.error || "删除失败");
      flash(true, `已删除记录「${job.name ?? job.files[0]?.originalName ?? job.id.slice(0, 10)}」`);
      setDelTarget(null);
      await load();
    } finally {
      setDelBusy(false);
    }
  }

  const filtered = jobs.filter((j) => {
    if (filter === "all") return true;
    if (filter === "workflow") return !j.jobType;
    return j.jobType === filter;
  });

  return (
    <div className="mx-auto w-[90%] max-w-[1800px] py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-normal text-[#202124]">BOM 历史记录</h1>
          <p className="mt-1 text-sm text-[#5f6368]">全员可见所有记录，支持启停扣减与版本替换。</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-[#dadce0] bg-white p-1">
          {([["all", "全部"], ["occupied_bom", "occupied"], ["target_bom", "target"], ["workflow", "BOM 匹配"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                filter === k ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#5f6368] hover:bg-[#f1f3f4]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className={`mb-4 rounded-md border px-4 py-2.5 text-sm ${msg.ok ? "border-[#a5d6a7] bg-[#e8f5e9] text-[#1b5e20]" : "border-[#f5c6cb] bg-[#fff3f3] text-[#9C0006]"}`}>
          {msg.text}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[#dadce0] bg-white">
        <div className="overflow-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-[#f8f9fa] text-left text-[#5f6368]">
              <tr>
                <th className="px-4 py-3 font-medium">文件名</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">套数</th>
                <th className="px-4 py-3 font-medium">上传时间</th>
                <th className="px-4 py-3 font-medium">扣减状态</th>
                <th className="px-4 py-3 font-medium">重复 / 替换</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[#9aa0a6]">暂无记录</td></tr>
              )}
              {filtered.map((j) => {
                const isOcc = j.jobType === "occupied_bom";
                const isActive = (j.deductionStatus ?? "active") === "active";
                return (
                  <tr key={j.id} className="hover:bg-[#fcfcfd]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#202124]">{j.name || j.files[0]?.originalName || "—"}</div>
                      <div className="text-xs text-[#9aa0a6]">
                        {j.files.map((f) => f.originalName).join("、") || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={j.jobType} />
                    </td>
                    <td className="px-4 py-3 text-[#5f6368]">{j.sets ?? "—"}</td>
                    <td className="px-4 py-3 text-[#5f6368]">{fmtTime(j.createdAt)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={j.deductionStatus ?? (isOcc ? "active" : "—")} />
                    </td>
                    <td className="px-4 py-3 text-xs text-[#5f6368]">
                      {j.duplicateOfJobId && <div>重复自 <span className="font-mono">{j.duplicateOfJobId.slice(0, 10)}</span></div>}
                      {j.replacedByJobId && <div className="text-[#c5221f]">已被 <span className="font-mono">{j.replacedByJobId.slice(0, 10)}</span> 替换</div>}
                      {j.bizKey && <div className="font-mono text-[#9aa0a6]">key: {j.bizKey}</div>}
                      {!j.duplicateOfJobId && !j.replacedByJobId && !j.bizKey && <span className="text-[#9aa0a6]">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {isOcc && (
                          <>
                            <button
                              onClick={() => toggle(j)}
                              disabled={busy === j.id || j.deductionStatus === "replaced" || j.deductionStatus === "duplicate"}
                              className={`rounded px-2 py-1 text-xs font-medium transition disabled:opacity-40 ${
                                isActive
                                  ? "bg-[#fce8e6] text-[#c5221f] hover:bg-[#f9d0cc]"
                                  : "bg-[#e6f4ea] text-[#137333] hover:bg-[#ceead6]"
                              }`}
                            >
                              {isActive ? "停用扣减" : "启用扣减"}
                            </button>
                            <button
                              onClick={() => replace(j)}
                              disabled={busy === j.id || !j.bizKey || isActive}
                              className="rounded bg-[#e8f0fe] px-2 py-1 text-xs font-medium text-[#1a73e8] transition hover:bg-[#d2e3fc] disabled:opacity-40"
                            >
                              替换旧版本
                            </button>
                          </>
                        )}
                        {j.jobType === "target_bom" && (
                          <Link
                            href="/workflow"
                            className="rounded bg-[#f1f3f4] px-2 py-1 text-xs font-medium text-[#3c4043] transition hover:bg-[#e8eaed]"
                          >
                            去匹配标色
                          </Link>
                        )}
                        {/* BOM 匹配任务（workflow）：查看带颜色标记的匹配结果 */}
                        {!j.jobType && (
                          <button
                            onClick={() => setPreviewJob({ id: j.id, name: j.name ?? j.files[0]?.originalName ?? "BOM" })}
                            disabled={j.status !== "done"}
                            className="rounded bg-[#1a73e8] px-2 py-1 text-xs font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-40"
                          >
                            {j.status === "done" ? "查看匹配结果" : "未匹配"}
                          </button>
                        )}
                        {/* 删除该历史记录（所有类型均支持） */}
                        <button
                          onClick={() => setDelTarget(j)}
                          disabled={busy === j.id}
                          className="rounded bg-[#fce8e6] px-2 py-1 text-xs font-medium text-[#c5221f] transition hover:bg-[#f9d0cc] disabled:opacity-40"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {previewJob && (
        <ResultPreviewModal
          jobId={previewJob.id}
          name={previewJob.name}
          onClose={() => setPreviewJob(null)}
        />
      )}

      <ConfirmDialog
        open={!!delTarget}
        danger
        busy={delBusy}
        title="删除历史记录"
        confirmText="确定删除"
        onCancel={() => setDelTarget(null)}
        onConfirm={() => {
          if (delTarget) doDelete(delTarget);
        }}
        message={
          <div>
            确定删除历史记录「<b>{delTarget?.name ?? delTarget?.files[0]?.originalName ?? delTarget?.id.slice(0, 10)}</b>」吗？
            <div className="mt-1 text-[#c5221f]">
              将同时删除其需求明细与磁盘文件，且<strong>不可恢复</strong>。
            </div>
          </div>
        }
      />
    </div>
  );
}

function TypeBadge({ type }: { type: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    occupied_bom: { label: "occupied 参与扣减", cls: "bg-[#fef7e0] text-[#b06000]" },
    target_bom: { label: "target 仅标色", cls: "bg-[#e6f4ea] text-[#137333]" },
    workflow: { label: "BOM 匹配（含结果）", cls: "bg-[#e8f0fe] text-[#1a73e8]" },
  };
  const m = map[type ?? "workflow"] ?? { label: type || "BOM 匹配", cls: "bg-[#e8f0fe] text-[#1a73e8]" };
  return <span className={`rounded px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "active", cls: "bg-[#e6f4ea] text-[#137333]" },
    inactive: { label: "inactive", cls: "bg-[#f1f3f4] text-[#5f6368]" },
    duplicate: { label: "duplicate", cls: "bg-[#fef7e0] text-[#b06000]" },
    replaced: { label: "replaced", cls: "bg-[#fce8e6] text-[#c5221f]" },
    parsed: { label: "已解析", cls: "bg-[#e8f0fe] text-[#1a73e8]" },
    done: { label: "已完成", cls: "bg-[#e6f4ea] text-[#137333]" },
    error: { label: "错误", cls: "bg-[#fce8e6] text-[#c5221f]" },
  };
  const m = map[status] ?? { label: status, cls: "bg-[#f1f3f4] text-[#5f6368]" };
  return <span className={`rounded px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>;
}
