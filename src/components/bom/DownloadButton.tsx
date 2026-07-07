"use client";

import { useCallback, useState } from "react";
import { downloadFile } from "@/lib/bom/client-download";

interface Props {
  jobId: string;
  file: string;
  filename: string;
  className?: string;
}

/** 历史任务页用的下载按钮（客户端，兼容沙箱 iframe） */
export default function DownloadButton({ jobId, file, filename, className }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handle = useCallback(async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    const res = await downloadFile(
      `/api/bom/download?jobId=${jobId}&file=${encodeURIComponent(file)}`,
      filename,
    );
    setBusy(false);
    if (!res.ok) setErr(res.error ?? "下载失败");
  }, [busy, jobId, file, filename]);

  return (
    <span className="inline-flex flex-col items-end">
      <button
        onClick={handle}
        disabled={busy}
        className={className}
        title={err ?? undefined}
      >
        {busy ? "下载中…" : "下载"}
      </button>
      {err && <span className="mt-0.5 text-[10px] text-red-500">{err}</span>}
    </span>
  );
}
