"use client";
import { useRef, useState } from "react";
import type { ResourcesState } from "./types";
import { uploadResource } from "@/lib/bom/client-resources";
import SheetPreviewModal from "./SheetPreviewModal";
interface Props {
  resources: ResourcesState;
  onUpdated: () => Promise<void> | void;
  /** 是否只读（配置步骤中仅展示，不可更新） */
  readOnly?: boolean;
}
/**
 * 库存表 / 工单表状态卡片：
 *  - 展示当日是否更新、当前文件名与行数
 *  - 可预览（弹窗）
 *  - 可更新（重新上传）
 */
export default function ResourceCards({ resources, onUpdated, readOnly }: Props) {
  const [busy, setBusy] = useState<"inventory" | "work_order" | null>(null);
  const [preview, setPreview] = useState<"inventory" | "work_order" | null>(null);
  const invInput = useRef<HTMLInputElement>(null);
  const woInput = useRef<HTMLInputElement>(null);
  const handleUpload = async (kind: "inventory" | "work_order", file: File) => {
    setBusy(kind);
    try {
      await uploadResource(kind, file);
      await onUpdated();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "更新失败");
    } finally {
      setBusy(null);
    }
  };
  const Card = ({
    kind,
    title,
    icon,
    inputRef,
  }: {
    kind: "inventory" | "work_order";
    title: string;
    icon: string;
    inputRef: React.RefObject<HTMLInputElement | null>;
  }) => {
    const r = kind === "inventory" ? resources.inventory : resources.workOrder;
    return (
      <div className="flex flex-col rounded-xl border border-[#dadce0] bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold text-[#202124]">
            <span className="text-base">{icon}</span>
            {title}
          </span>
          {r.exists ? (
            r.updatedToday ? (
              <span className="rounded-full bg-[#e6f4ea] px-2 py-0.5 text-xs font-medium text-[#137333]">
                ✓ 今日已更新
              </span>
            ) : (
              <span className="animate-pulse rounded-full bg-[#fce8e6] px-2 py-0.5 text-xs font-bold text-[#d93025]">
                ⚠ 需更新
              </span>
            )
          ) : (
            <span className="rounded-full bg-[#f1f3f4] px-2 py-0.5 text-xs font-medium text-[#9aa0a6]">
              未上传
            </span>
          )}
        </div>
        <div className="mt-2 min-h-[2.5rem] flex-1 text-xs text-[#5f6368]">
          {r.exists ? (
            r.file ? (
              <div>
                <div className="truncate font-medium text-[#202124]">
                  {r.file.originalName}
                </div>
                <div className="mt-0.5">
                  {r.file.mainSheet} · {r.file.rowCount} 行
                </div>
              </div>
            ) : (
              "已上传"
            )
          ) : (
            "尚未上传该数据"
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) handleUpload(kind, f);
          }}
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setPreview(kind)}
            disabled={!r.exists}
            className="flex-1 rounded-full border border-[#dadce0] px-3 py-1.5 text-xs font-medium text-[#1a73e8] transition hover:bg-[#e8f0fe] disabled:opacity-40"
          >
            👁 预览
          </button>
          {!readOnly && (
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy !== null}
              className="flex-1 rounded-full border border-[#dadce0] px-3 py-1.5 text-xs font-medium text-[#3c4043] transition hover:bg-[#f1f3f4] disabled:opacity-50"
            >
              {busy === kind ? "更新中…" : r.exists ? "更新" : "上传"}
            </button>
          )}
        </div>
      </div>
    );
  };
  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card kind="inventory" title="库存表" icon="📦" inputRef={invInput} />
        <Card kind="work_order" title="工单调拨齐套报表" icon="📋" inputRef={woInput} />
      </div>
      {preview && (
        <SheetPreviewModal
          kind={preview}
          originalName={
            preview === "inventory"
              ? resources.inventory.file?.originalName ?? "库存表"
              : resources.workOrder.file?.originalName ?? "工单报表"
          }
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
