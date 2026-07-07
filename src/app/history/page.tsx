import Link from "next/link";
import { listJobs } from "@/lib/bom/storage";
import DownloadButton from "@/components/bom/DownloadButton";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  bom: "BOM",
  inventory: "库存表",
  bills: "单据",
  transfer: "调拨",
};

function fmtDate(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "—";
  }
}

export default async function HistoryPage() {
  const jobs = await listJobs(30);

  return (
    <main className="min-h-screen bg-white">
      {/* 顶部栏 */}
      <header className="sticky top-0 z-30 border-b border-[#dadce0] bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-[90%] max-w-[1800px] items-center justify-between py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1a73e8] text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
            </div>
            <span className="text-[15px] font-medium text-[#202124]">历史任务</span>
          </div>
          <Link
            href="/"
            className="rounded-full bg-[#1a73e8] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[#1765cc]"
          >
            + 新任务
          </Link>
        </div>
      </header>

      <div className="mx-auto w-[90%] max-w-[1800px] py-8">
        <h1 className="mb-4 text-xl font-normal text-[#202124]">最近任务</h1>

        {jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#dadce0] bg-[#f8f9fa] p-16 text-center">
            <p className="text-sm text-[#5f6368]">暂无历史任务</p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-full bg-[#1a73e8] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#1765cc]"
            >
              创建第一个任务
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#dadce0]">
            <div className="g-scroll overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#f8f9fa] text-[#5f6368]">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">文件</th>
                    <th className="px-4 py-3 text-left font-medium">状态</th>
                    <th className="px-4 py-3 text-right font-medium">物料行</th>
                    <th className="px-4 py-3 text-right font-medium">欠料</th>
                    <th className="px-4 py-3 text-left font-medium">创建时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e1e3e6]">
                  {jobs.map((j) => {
                    const summary = j.summary as
                      | {
                          totalRows?: number;
                          shortageCount?: number;
                          outputFileName?: string;
                        }
                      | undefined;
                    return (
                      <tr key={j.id} className="bg-white hover:bg-[#f8f9fa]">
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(j.files ?? []).slice(0, 3).map((f, i) => (
                              <span
                                key={i}
                                className="inline-block max-w-[160px] truncate rounded bg-[#f1f3f4] px-1.5 py-0.5 text-xs text-[#3c4043]"
                                title={f.originalName}
                              >
                                {KIND_LABELS[f.kind] ?? "文件"}: {f.originalName}
                              </span>
                            ))}
                            {(j.files?.length ?? 0) > 3 && (
                              <span className="text-xs text-[#9aa0a6]">
                                +{(j.files?.length ?? 0) - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={j.status} />
                        </td>
                        <td className="px-4 py-3 text-right text-[#3c4043]">
                          {summary?.totalRows ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {summary?.shortageCount !== undefined ? (
                            <span
                              className={
                                summary.shortageCount > 0
                                  ? "font-medium text-[#d93025]"
                                  : "text-[#9aa0a6]"
                              }
                            >
                              {summary.shortageCount}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#5f6368]">
                          {fmtDate(j.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {summary?.outputFileName && j.status === "done" ? (
                            <DownloadButton
                              jobId={j.id}
                              file={summary.outputFileName}
                              filename={summary.outputFileName}
                              className="rounded-full bg-[#e8f0fe] px-3 py-1 text-xs font-medium text-[#1a73e8] transition hover:bg-[#d2e3fc] disabled:opacity-50"
                            />
                          ) : (
                            <span className="text-xs text-[#dadce0]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    parsed: { label: "待处理", cls: "bg-[#f1f3f4] text-[#5f6368]" },
    configured: { label: "已配置", cls: "bg-[#e8f0fe] text-[#174ea6]" },
    done: { label: "已完成", cls: "bg-[#e6f4ea] text-[#137333]" },
    error: { label: "出错", cls: "bg-[#fce8e6] text-[#c5221f]" },
  };
  const s = map[status] ?? { label: status, cls: "bg-[#f1f3f4] text-[#5f6368]" };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
