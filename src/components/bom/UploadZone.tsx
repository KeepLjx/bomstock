"use client";
import { useCallback, useRef, useState } from "react";
import type { ParsedFileDTO, UploadResponse, ResourcesState } from "./types";
import { KIND_LABELS } from "./types";
import ResourceCards from "./ResourceCards";
interface Props {
  onConfirmed: (res: UploadResponse) => void;
  onError: (msg: string) => void;
  /** 退回此步骤时恢复的已确认任务（保留已上传文件列表） */
  initialJobId?: string | null;
  initialFiles?: ParsedFileDTO[];
  /** 持久数据资源状态（库存表 / 工单表） */
  resources?: ResourcesState | null;
  onResourcesUpdated?: () => Promise<void> | void;
}
const KIND_ICON: Record<ParsedFileDTO["kind"], string> = {
  bom: "🧾",
  inventory: "📦",
  bills: "📑",
  transfer: "📋",
};
export default function UploadZone({
  onConfirmed,
  onError,
  initialJobId,
  initialFiles,
  resources,
  onResourcesUpdated,
}: Props) {
  const [jobId, setJobId] = useState<string | null>(initialJobId ?? null);
  const [files, setFiles] = useState<ParsedFileDTO[]>(initialFiles ?? []);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<Record<string, boolean>>({});
  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const refreshNoop = async () => {};
  const bomFiles = files.filter((f) => f.kind === "bom");
  const missingYibo = bomFiles.filter((f) => !f.hasYiboCode);
  const yiboWarning =
    missingYibo.length > 0
      ? missingYibo.map((m) => m.originalName).join("、")
      : null;
  // 一博物料编码缺失时，禁止进入下一步
  const canConfirm = files.length > 0 && missingYibo.length === 0;
  const upload = useCallback(
    async (fileList: FileList | File[]) => {
      const picked = Array.from(fileList).filter((f) =>
        /\.(xlsx|xlsm|xls)$/i.test(f.name),
      );
      if (picked.length === 0) {
        onError("请选择 Excel 文件（.xlsx / .xlsm）");
        return;
      }
      setUploading(true);
      try {
        const fd = new FormData();
        for (const f of picked) fd.append("files", f);
        if (jobId) fd.append("jobId", jobId);
        const res = await fetch("/api/bom/upload", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) {
          onError(data.error || "上传失败");
          return;
        }
        setJobId(data.jobId);
        setFiles(data.files as ParsedFileDTO[]);
        // 若本次上传更新了库存/工单资源，刷新前端资源状态
        if (data.updatedResources?.length && onResourcesUpdated) {
          await onResourcesUpdated();
        }
      } catch (e) {
        onError(`上传失败：${(e as Error).message}`);
      } finally {
        setUploading(false);
      }
    },
    [jobId, onError, onResourcesUpdated],
  );
  const removeFile = useCallback(
    async (storedName: string) => {
      if (!jobId) return;
      setRemoving((p) => ({ ...p, [storedName]: true }));
      try {
        const res = await fetch("/api/bom/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, storedName }),
        });
        const data = await res.json();
        if (!res.ok) {
          onError(data.error || "删除失败");
          return;
        }
        setFiles(data.files as ParsedFileDTO[]);
      } catch (e) {
        onError(`删除失败：${(e as Error).message}`);
      } finally {
        setRemoving((p) => ({ ...p, [storedName]: false }));
      }
    },
    [jobId, onError],
  );
  const startReplace = (storedName: string) => {
    replaceTarget.current = storedName;
    replaceInputRef.current?.click();
  };
  const onReplacePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target = replaceTarget.current;
    replaceTarget.current = null;
    if (!file || !target) return;
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      onError("请选择 Excel 文件（.xlsx / .xlsm）");
      return;
    }
    // 先删除旧文件，再上传新文件（保持同一任务）
    await removeFile(target);
    await upload([file]);
  };
  const confirm = () => {
    if (!canConfirm || !jobId) return;
    onConfirmed({
      jobId,
      files,
      yiboWarning: null,
    });
  };
  return (
    <div className="space-y-6">
      {/* 持久数据资源：库存表 / 工单表（每日更新） */}
      {resources && (
        <div className="rounded-xl border border-[#dadce0] bg-[#f8f9fa] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#202124]">
              📊 数据资源（库存表 / 工单表，每日更新）
            </h3>
            <span className="text-xs text-[#5f6368]">
              匹配时自动引用最新库存与工单
            </span>
          </div>
          <ResourceCards resources={resources} onUpdated={onResourcesUpdated ?? refreshNoop} />
        </div>
      )}
      {/* BOM 文件上传区 */}
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-[#202124]">🧾 上传 BOM 文件</h3>
        <span className="text-xs text-[#5f6368]">
          （库存表 / 工单表请在上方更新，此处只需上传 BOM）
        </span>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* 左：上传区 */}
        <div className="flex lg:col-span-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) upload(e.dataTransfer.files);
            }}
            onClick={() => addInputRef.current?.click()}
            className={`flex h-full min-h-[280px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-8 py-10 text-center transition ${
              dragOver
                ? "border-[#1a73e8] bg-[#e8f0fe]"
                : "border-[#dadce0] bg-[#f8f9fa] hover:border-[#1a73e8] hover:bg-[#f1f3f4]"
            }`}
          >
            <input
              ref={addInputRef}
              type="file"
              multiple
              accept=".xlsx,.xlsm,.xls"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) upload(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept=".xlsx,.xlsm,.xls"
              className="hidden"
              onChange={onReplacePicked}
            />
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f0fe] text-[#1a73e8]">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className="mt-3 text-base font-medium text-[#202124]">
              {uploading
                ? "正在解析文件…"
                : files.length > 0
                  ? "继续添加文件，或拖放到此处"
                  : "拖放文件到此处，或点击选择"}
            </p>
            <p className="mt-1 text-sm text-[#5f6368]">
              支持 .xlsx / .xlsm · 可单个或多个上传 BOM、库存等文件
            </p>
            {uploading && (
              <div className="mt-4 h-1 w-48 overflow-hidden rounded-full bg-[#dadce0]">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-[#1a73e8]" />
              </div>
            )}
          </div>
        </div>
        {/* 右：说明 */}
        <div className="lg:col-span-2">
          <div className="h-full rounded-2xl border border-[#dadce0] bg-white p-6">
            <h3 className="text-sm font-medium text-[#202124]">使用说明</h3>
            <ol className="mt-4 space-y-3 text-sm text-[#5f6368]">
              <Step n={1} title="上传并确认文件">
                上传目标 BOM（须含「一博物料编码」列）、库存表等，可随时替换或删除，确认无误后点击「确认」。
              </Step>
              <Step n={2} title="确认配置">
                指派 BOM 角色、填写生产套数、核对列映射，点击表名可弹窗预览。
              </Step>
              <Step n={3} title="查看与编辑">
                在结果表格中直接编辑单元格，导出带颜色标记的 XLSX。
              </Step>
            </ol>
            <div className="mt-5 rounded-lg bg-[#e8f0fe] p-3 text-xs leading-relaxed text-[#174ea6]">
              自动清洗：忽略 Change Log 工作表，剔除空列与仅含颜色的无意义列，转为 CSV 后匹配。
            </div>
          </div>
        </div>
      </div>
      {/* 已上传文件列表 */}
      {files.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#dadce0] bg-white">
          <div className="flex items-center justify-between border-b border-[#e8eaed] bg-[#f8f9fa] px-4 py-2.5">
            <h3 className="text-sm font-medium text-[#202124]">
              已上传文件（{files.length}）
            </h3>
            <button
              onClick={() => addInputRef.current?.click()}
              disabled={uploading}
              className="rounded-full border border-[#1a73e8] px-3 py-1 text-xs font-medium text-[#1a73e8] transition hover:bg-[#e8f0fe] disabled:opacity-50"
            >
              ＋ 添加文件
            </button>
          </div>
          <ul className="divide-y divide-[#e8eaed]">
            {files.map((f) => {
              const miss = f.kind === "bom" && !f.hasYiboCode;
              return (
                <li
                  key={f.storedName}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <span className="text-lg">{KIND_ICON[f.kind]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-[#202124]">
                        {f.originalName}
                      </span>
                      <span className="rounded-full bg-[#e8f0fe] px-2 py-0.5 text-xs font-medium text-[#174ea6]">
                        {KIND_LABELS[f.kind]}
                      </span>
                      <span className="text-xs text-[#9aa0a6]">
                        {f.mainSheet} · {f.rowCount} 行
                      </span>
                    </div>
                  </div>
                  {/* 一博物料编码状态 */}
                  {f.kind === "bom" &&
                    (miss ? (
                      <span className="inline-flex animate-pulse items-center rounded-full bg-[#fce8e6] px-2.5 py-0.5 text-xs font-bold text-[#d93025] ring-1 ring-[#d93025]/40">
                        ⚠ 缺少一博物料编码
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-[#e6f4ea] px-2 py-0.5 text-xs font-medium text-[#137333]">
                        ✓ 一博编码
                      </span>
                    ))}
                  {/* 操作 */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => startReplace(f.storedName)}
                      disabled={uploading || removing[f.storedName]}
                      className="rounded-full border border-[#dadce0] px-3 py-1 text-xs font-medium text-[#3c4043] transition hover:bg-[#f1f3f4] disabled:opacity-50"
                    >
                      替换
                    </button>
                    <button
                      onClick={() => removeFile(f.storedName)}
                      disabled={uploading || removing[f.storedName]}
                      className="rounded-full border border-[#dadce0] px-3 py-1 text-xs font-medium text-[#d93025] transition hover:bg-[#fce8e6] disabled:opacity-50"
                    >
                      {removing[f.storedName] ? "删除中…" : "删除"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {/* 红色警告：缺少一博物料编码，禁止确认 */}
      {yiboWarning && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-[#d93025]/50 bg-[#fce8e6] p-4 text-sm text-[#a50e0e]">
          <span className="text-lg leading-none">🚫</span>
          <div className="flex-1">
            <div className="font-semibold">
              以下 BOM 文件缺少「一博物料编码」列，无法进入下一步：
            </div>
            <div className="mt-1 font-medium">{yiboWarning}</div>
            <div className="mt-1 text-xs text-[#a50e0e]/80">
              请点击对应文件的「替换」按钮，重新上传包含该列的文件后再确认。
            </div>
          </div>
        </div>
      )}
      {/* 确认按钮 */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-[#9aa0a6]">
          {files.length === 0
            ? "请先上传文件"
            : canConfirm
              ? `已上传 ${files.length} 个文件，确认无误后进入配置`
              : "请先补全「一博物料编码」列后再确认"}
        </p>
        <button
          onClick={confirm}
          disabled={!canConfirm || uploading}
          className={`flex items-center gap-2 rounded-full px-8 py-2.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed ${
            canConfirm && !uploading
              ? "bg-[#1a73e8] text-white hover:bg-[#1765cc]"
              : "bg-[#dadce0] text-[#5f6368]"
          }`}
        >
          {uploading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <span>✓</span>
          )}
          {uploading ? "处理中…" : "确认"}
        </button>
      </div>
    </div>
  );
}
function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#1a73e8] text-xs font-medium text-white">
        {n}
      </span>
      <div>
        <div className="font-medium text-[#202124]">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[#5f6368]">
          {children}
        </div>
      </div>
    </li>
  );
}