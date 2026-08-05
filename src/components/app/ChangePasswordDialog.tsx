"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

export default function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (newPassword !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "修改失败");
        return;
      }
      setOk(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium text-[#202124]">修改密码</h2>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]">✕</button>
        </div>
        {error && (
          <div className="mb-3 rounded-md border border-[#f5c6cb] bg-[#fff3f3] px-3 py-2 text-sm text-[#9C0006]">{error}</div>
        )}
        {ok && (
          <div className="mb-3 rounded-md border border-[#a5d6a7] bg-[#e8f5e9] px-3 py-2 text-sm text-[#1b5e20]">密码修改成功</div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-[#5f6368]">原密码</label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-md border border-[#dadce0] px-3 py-2 text-sm outline-none focus:border-[#1a73e8]"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-[#5f6368]">新密码（至少 6 位）</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-md border border-[#dadce0] px-3 py-2 text-sm outline-none focus:border-[#1a73e8]"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-[#5f6368]">确认新密码</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-md border border-[#dadce0] px-3 py-2 text-sm outline-none focus:border-[#1a73e8]"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[#1a73e8] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-60"
          >
            {loading ? "提交中…" : "确认修改"}
          </button>
        </form>
      </div>
    </div>
  );
}
