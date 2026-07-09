"use client";
import { useRef, useState } from "react";
import type { ResourcesState } from "./types";
import { uploadResource } from "@/lib/bom/client-resources";
interface Props {
  resources: ResourcesState;
  /** 更新完成后回调，刷新状态 */
  onUpdated: () => Promise<void> | void;
}
/**
 * 每日更新强制弹窗：
 * 库存表 / 工单表必须当天更新，否则无法进行后续操作。
 * 缺失或未当日更新的资源会在此弹窗中要求上传/更新。
 */
export default function UpdateRequiredModal({ resources, onUpdated }: Props) {
  const [busy, setBusy] = useState<"inventory" | "work_order" | null>(null);
  const invInput = useRef<HTMLInputElement>(null);
  const woInput = useRef<HTMLInputElement>(null);
  const invOutdated = !resources.inventory.updatedToday;
  const woOutdated = !resources.workOrder.updatedToday;
  const handleUpload = async (
    kind: "inventory" | "work_order",
    file: File,
  ) => {
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
    desc,
    outdated,
    inputRef,
  }: {
    kind: "inventory" | "work_order";
    title: string;
    desc: string;
    outdated: boolean;
    inputRef: React.RefObject<HTMLInputElement | null>;
  }) => (
    <div
      className={`rounded-xl border p-4 ${
        outdated
          ? "border-[#d93025]/40 bg-[#fce8e6]"
          : "border-[#dadce0] bg-[#e6f4ea]"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#202124]">{title}</span>
        {outdated ? (
          <span className="rounded-full bg-[#d93025] px-2 py-0.5 text-xs font-bold text-white">
            需更新
          </span>
        ) : (
          <span className="rounded-full bg-[#137333] px-2 py-0.5 text-xs font-medium text-white">
            ✓ 今日已更新
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-[#5f6368]">{desc}</p>
      {kind === "inventory" && resources.inventory.file && (
        <p className="mt-1 text-xs text-[#9aa0a6]">
          当前：{resources.inventory.file.originalName} ·{" "}
          {resources.inventory.file.rowCount} 行
        </p>
      )}
      {kind === "work_order" && resources.workOrder.file && (
        <p className="mt-1 text-xs text-[#9aa0a6]">
          当前：{resources.workOrder.file.originalName} ·{" "}
          {resources.workOrder.file.rowCount} 行
        </p>
      )}
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
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy !== null}
        className="mt-3 w-full rounded-full bg-[#1a73e8] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-50"
      >
        {busy === kind ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            更新中…
          </span>
        ) : outdated ? (
          "上传 / 更新"
        ) : (
          "重新上传"
        )}
      </button>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-[#dadce0] px-6 py-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-[#202124]">
            <span>🔄</span> 每日数据更新
          </h3>
          <p className="mt-1 text-sm text-[#5f6368]">
            库存表与工单表需要每天更新以保证数据准确。请先完成以下更新，再进行 BOM 匹配。
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 px-6 py-5 sm:grid-cols-2">
          <Card
            kind="inventory"
            title="库存表"
            desc="物料库存（须含物料编码、总数量）"
            outdated={invOutdated}
            inputRef={invInput}
          />
          <Card
            kind="work_order"
            title="工单调拨齐套报表"
            desc="工单报表（成品名称、计划数量）"
            outdated={woOutdated}
            inputRef={woInput}
          />
        </div>
        <div className="border-t border-[#e8eaed] bg-[#f8f9fa] px-6 py-3">
          <p className="text-center text-xs text-[#9aa0a6]">
            {invOutdated || woOutdated
              ? "两类数据均需在今日更新后才能继续操作"
              : "✓ 数据已是最新，可关闭继续"}
          </p>
        </div>
      </div>
    </div>
  );
}
