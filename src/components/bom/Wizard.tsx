"use client";

import { useState } from "react";
import UploadZone from "./UploadZone";
import ConfigPanel, { type ProcessPayload } from "./ConfigPanel";
import EditableTable from "./EditableTable";
import type {
  UploadResponse,
  WorkflowSummaryDTO,
  TableDataDTO,
} from "./types";

type Step = "upload" | "config" | "result";

const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "上传" },
  { key: "config", label: "配置" },
  { key: "result", label: "结果" },
];

export default function Wizard() {
  const [step, setStep] = useState<Step>("upload");
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [summary, setSummary] = useState<WorkflowSummaryDTO | null>(null);
  const [table, setTable] = useState<TableDataDTO | null>(null);
  const [baseName, setBaseName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleConfirmed = (res: UploadResponse) => {
    setUpload(res);
    setError(null);
    setStep("config");
  };

  const handleFileUpdated = (updatedFile: UploadResponse["files"][number]) => {
    setUpload((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        files: prev.files.map((file) =>
          file.storedName === updatedFile.storedName ? updatedFile : file,
        ),
      };
    });
  };

  const handleExecute = async (payload: ProcessPayload) => {
    setError(null);
    setProcessing(true);
    try {
      const res = await fetch("/api/bom/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: upload?.jobId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "执行失败");
        return;
      }
      setSummary(data.summary as WorkflowSummaryDTO);
      setTable(data.table as TableDataDTO);
      const target = upload?.files.find(
        (f) => f.storedName === payload.targetStoredName,
      );
      setBaseName(target?.originalName?.replace(/\.(xlsx|xlsm|xls)$/i, "") || "BOM");
      setStep("result");
    } catch (e) {
      setError(`执行失败：${(e as Error).message}`);
    } finally {
      setProcessing(false);
    }
  };

  const restart = () => {
    setUpload(null);
    setSummary(null);
    setTable(null);
    setError(null);
    setStep("upload");
  };
  // 退回上传步骤修改文件（保留已确认的数据，不整体重置）
  const backToUpload = () => {
    setError(null);
    setStep("upload");
  };

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);
  // 各步骤是否已到达（具备展示所需数据）—— 决定能否点击切换
  const reached: Record<Step, boolean> = {
    upload: true,
    config: !!upload,
    result: !!upload && !!summary && !!table,
  };
  // 点击步骤切换：仅在「已到达」时允许，从而可退回上一步修改
  const gotoStep = (target: Step) => {
    if (!reached[target]) return;
    setError(null);
    setStep(target);
  };
  return (
    <div className="space-y-6">
      {/* 步骤指示器（可点击切换已到达的步骤） */}
      <div className="flex items-center justify-center">
        {STEPS.map((s, i) => {
          const clickable = reached[s.key];
          const done = i < currentStepIndex && reached[s.key];
          const active = i === currentStepIndex;
          return (
            <div key={s.key} className="flex items-center">
              <button
                type="button"
                onClick={() => gotoStep(s.key)}
                disabled={!clickable}
                title={
                  clickable ? `切换到「${s.label}」` : "该步骤尚未到达"
                }
                className={`flex flex-col items-center outline-none ${
                  clickable
                    ? "cursor-pointer"
                    : "cursor-not-allowed"
                }`}
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition ${
                    active
                      ? "bg-[#1a73e8] text-white ring-4 ring-[#1a73e8]/20"
                      : done
                        ? "bg-[#1a73e8] text-white hover:bg-[#1765cc]"
                        : "bg-[#f1f3f4] text-[#9aa0a6]"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </div>
                <span
                  className={`mt-1.5 text-xs transition ${
                    active
                      ? "font-medium text-[#1a73e8]"
                      : reached[s.key]
                        ? "text-[#1a73e8] hover:underline"
                        : "text-[#9aa0a6]"
                  }`}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className={`mx-3 h-px w-12 sm:w-20 ${
                    i < currentStepIndex ? "bg-[#1a73e8]" : "bg-[#dadce0]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 错误/警告提示 */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-[#f9ab00]/30 bg-[#fef7e0] p-3 text-sm text-[#b06000]">
          <span className="leading-none">⚠</span>
          <div className="flex-1">{error}</div>
          <button
            onClick={() => setError(null)}
            className="text-[#b06000]/60 hover:text-[#b06000]"
          >
            ✕
          </button>
        </div>
      )}

      {/* 步骤内容 */}
       {step === "upload" && (
        <div className="space-y-6">
          <UploadZone
            onConfirmed={handleConfirmed}
            onError={setError}
            initialJobId={upload?.jobId}
            initialFiles={upload?.files}
          />
        </div>
      )}

     {step === "config" && upload && (
        <ConfigPanel
          jobId={upload.jobId}
          files={upload.files}
          onFileUpdated={handleFileUpdated}
          onExecute={handleExecute}
          onBack={backToUpload}
          processing={processing}
        />
      )}

      {step === "result" && summary && table && upload && (
        <EditableTable
          jobId={upload.jobId}
          table={table}
          baseName={baseName}
          outputFileName={summary.outputFileName}
          summary={{
            shortageCount: summary.shortageCount,
            blueCount: summary.blueCount,
            greenCount: summary.greenCount,
            totalRows: summary.totalRows,
            skippedBoms: summary.skippedBoms,
            deductionBomCount: summary.deductionBomCount,
          }}
          onRestart={restart}
        />
      )}
    </div>
  );
}
