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

  const handleUploaded = (res: UploadResponse) => {
    setUpload(res);
    setError(res.yiboWarning);
    setStep("config");
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

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-6">
      {/* 步骤指示器 */}
      <div className="flex items-center justify-center">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition ${
                  i <= currentStepIndex
                    ? "bg-[#1a73e8] text-white"
                    : "bg-[#f1f3f4] text-[#9aa0a6]"
                }`}
              >
                {i < currentStepIndex ? "✓" : i + 1}
              </div>
              <span
                className={`mt-1.5 text-xs ${
                  i <= currentStepIndex ? "text-[#1a73e8]" : "text-[#9aa0a6]"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-3 h-px w-12 sm:w-20 ${
                  i < currentStepIndex ? "bg-[#1a73e8]" : "bg-[#dadce0]"
                }`}
              />
            )}
          </div>
        ))}
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
          <UploadZone onUploaded={handleUploaded} onError={setError} />
        </div>
      )}

      {step === "config" && upload && (
        <ConfigPanel
          files={upload.files}
          onExecute={handleExecute}
          onBack={restart}
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
