"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function AuthForm() {
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/";
  const expired = params.get("expired") === "1";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function reset() {
    setError(null);
    setPassword("");
    setConfirmPassword("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "register") {
        if (password !== confirmPassword) {
          setError("两次输入的密码不一致");
          setLoading(false);
          return;
        }
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, displayName }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "注册失败");
          setLoading(false);
          return;
        }
        // 注册成功直接登录 -> 硬跳转
        window.location.href = redirect;
        return;
      }
      // login
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "登录失败");
        setLoading(false);
        return;
      }
      window.location.href = redirect;
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-[#1a73e8] text-white">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          </div>
          <h1 className="text-xl font-medium text-[#202124]">BOM 库存预扣减系统</h1>
          <p className="mt-1 text-sm text-[#5f6368]">登录后使用系统（全员操作员，数据共享）</p>
        </div>

        {/* 模式切换 */}
        <div className="mb-4 flex gap-1 rounded-lg border border-[#dadce0] bg-white p-1">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                reset();
                if (m === "register") setUsername("");
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                mode === m ? "bg-[#1a73e8] text-white" : "text-[#5f6368] hover:bg-[#f1f3f4]"
              }`}
            >
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="rounded-xl border border-[#dadce0] bg-white p-6 shadow-sm">
          {expired && (
            <div className="mb-4 rounded-md border border-[#f5c6cb] bg-[#fff3f3] px-3 py-2 text-sm text-[#9C0006]">
              登录已过期，请重新登录
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-md border border-[#f5c6cb] bg-[#fff3f3] px-3 py-2 text-sm text-[#9C0006]">
              {error}
            </div>
          )}
          <label className="mb-1 block text-sm font-medium text-[#202124]">用户名</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="mb-4 w-full rounded-md border border-[#dadce0] px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
            placeholder="请输入用户名"
          />
          {mode === "register" && (
            <>
              <label className="mb-1 block text-sm font-medium text-[#202124]">显示名（可选）</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mb-4 w-full rounded-md border border-[#dadce0] px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                placeholder="用于日志展示"
              />
            </>
          )}
          <label className="mb-1 block text-sm font-medium text-[#202124]">密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="mb-4 w-full rounded-md border border-[#dadce0] px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
            placeholder="请输入密码"
          />
          {mode === "register" && (
            <>
              <label className="mb-1 block text-sm font-medium text-[#202124]">确认密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="mb-4 w-full rounded-md border border-[#dadce0] px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                placeholder="再次输入密码"
              />
            </>
          )}
          {mode === "login" && (
            <label className="mb-4 flex items-center gap-2 text-sm text-[#5f6368]">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 accent-[#1a73e8]"
              />
              记住登录（7 天）
            </label>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[#1a73e8] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1765cc] disabled:opacity-60"
          >
            {loading
              ? mode === "login" ? "登录中…" : "注册中…"
              : mode === "login" ? "登录" : "注册并登录"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm />
    </Suspense>
  );
}
