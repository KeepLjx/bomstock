import { NextRequest, NextResponse } from "next/server";
import { destroySession, SESSION_COOKIE, getRequestUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  if (user) {
    await writeAudit({ userId: user.id, action: "logout" });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
