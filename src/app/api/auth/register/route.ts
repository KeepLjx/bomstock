import { NextRequest, NextResponse } from "next/server";
import { createUser, ensureDefaultUser, createSession, SESSION_COOKIE } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 注册新用户（全员操作员，同权） */
export async function POST(req: NextRequest) {
  try {
    await ensureDefaultUser();
    const body = await req.json().catch(() => ({}));
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? "");

    const result = await createUser({ username, password, displayName });
    if (!result.ok || !result.user) {
      return NextResponse.json({ error: result.error ?? "注册失败" }, { status: 400 });
    }

    // 注册成功直接登录
    const session = await createSession(result.user.id);
    await writeAudit({
      userId: result.user.id,
      action: "register",
      detail: { username: result.user.username },
    });

    const res = NextResponse.json({ user: result.user });
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: session.maxAge,
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: `注册失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
