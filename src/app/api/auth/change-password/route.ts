import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError, changeUserPassword } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 修改密码：校验原密码后写入新密码 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const oldPassword = String(body.oldPassword ?? "");
    const newPassword = String(body.newPassword ?? "");

    const result = await changeUserPassword(user.id, oldPassword, newPassword);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "修改失败" }, { status: 400 });
    }
    await writeAudit({ userId: user.id, action: "change_password" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `修改失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
