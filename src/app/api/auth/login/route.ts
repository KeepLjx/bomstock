import { NextRequest, NextResponse } from "next/server";
import {
  ensureDefaultUser,
  findUserByUsername,
  verifyPassword,
  createSession,
  SESSION_COOKIE,
  UnauthorizedError,
} from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureDefaultUser();
    const body = await req.json().catch(() => ({}));
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    const remember = body.remember !== false;

    if (!username || !password) {
      return NextResponse.json(
        { error: "请输入用户名和密码" },
        { status: 400 },
      );
    }

    const user = await findUserByUsername(username);
    const ok = user && user.status === "active" && verifyPassword(password, user.passwordHash);
    if (!user || !ok) {
      await writeAudit({
        userId: user?.id ?? null,
        action: "login",
        detail: { username, success: false },
      });
      return NextResponse.json(
        { error: "用户名或密码错误" },
        { status: 401 },
      );
    }

    const session = await createSession(user.id);
    await writeAudit({
      userId: user.id,
      action: "login",
      detail: { success: true },
    });

    const res = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
      },
    });
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: remember ? session.expiresAt : undefined,
      maxAge: remember ? session.maxAge : undefined,
    });
    return res;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    return NextResponse.json(
      { error: `登录失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
