"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ChangePasswordDialog from "./ChangePasswordDialog";

interface MeUser {
  id: string;
  username: string;
  displayName: string | null;
}

// 顺序：首页 → 实时库存 → BOM 匹配 → 历史记录 → 操作日志
const LINKS = [
  { href: "/", label: "首页" },
  { href: "/inventory", label: "实时库存" },
  { href: "/workflow", label: "BOM 匹配" },
  { href: "/history", label: "历史记录" },
  { href: "/logs", label: "操作日志" },
];

export default function Nav() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUser(d?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <>
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
            <span className="text-[15px] font-medium text-[#202124]">
              BOM 库存预扣减系统
            </span>
            <nav className="ml-4 hidden items-center gap-1 md:flex">
              {LINKS.map((l) => {
                const active = pathname === l.href;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                      active
                        ? "bg-[#e8f0fe] text-[#1a73e8]"
                        : "text-[#5f6368] hover:bg-[#f1f3f4]"
                    }`}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {!loading && user && (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-full border border-[#dadce0] px-3 py-1.5 text-sm font-medium text-[#3c4043] transition hover:bg-[#f1f3f4]"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1a73e8] text-xs text-white">
                    {(user.displayName || user.username).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden sm:inline">{user.displayName || user.username}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-lg border border-[#dadce0] bg-white py-1 shadow-lg">
                      <div className="border-b border-[#eee] px-3 py-2">
                        <div className="text-sm font-medium text-[#202124]">{user.displayName || user.username}</div>
                        <div className="text-xs text-[#9aa0a6]">@{user.username} · 操作员</div>
                      </div>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setPwOpen(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#3c4043] hover:bg-[#f1f3f4]"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                        修改密码
                      </button>
                      <button
                        onClick={logout}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#c5221f] hover:bg-[#fce8e6]"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                        退出登录
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      {pwOpen && <ChangePasswordDialog onClose={() => setPwOpen(false)} />}
    </>
  );
}
