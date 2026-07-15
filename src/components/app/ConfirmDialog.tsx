"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（删除等）使用红色确认按钮 */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 通用确认弹窗：用于「同步到全局」「删除」等需要二次确认的操作。
 * 用 ESC 或点击遮罩取消。
 */
export default function ConfirmDialog({
  open,
  title = "确认操作",
  message,
  confirmText = "确定",
  cancelText = "取消",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-medium text-[#202124]">{title}</h3>
        <div className="mt-2 text-sm leading-relaxed text-[#3c4043]">{message}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-[#dadce0] px-4 py-2 text-sm font-medium text-[#3c4043] transition hover:bg-[#f1f3f4] disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white transition disabled:opacity-60 ${
              danger ? "bg-[#d93025] hover:bg-[#b3261e]" : "bg-[#1a73e8] hover:bg-[#1765cc]"
            }`}
          >
            {busy ? "处理中…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
