import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError, listUsers } from "@/lib/auth";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTION_LABELS: Record<string, string> = {
  login: "登录",
  logout: "退出登录",
  register: "注册",
  change_password: "修改密码",
  upload_inventory: "上传库存表",
  upload_work_order: "上传工单表",
  upload_occupied_bom: "上传 occupied BOM",
  upload_target_bom: "上传 target BOM",
  toggle_active: "启停扣减",
  replace: "版本替换",
  recalculate: "模拟重算",
  set_current_inventory: "切换 current 库存",
  delete_job: "删除任务",
};

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);

    const sp = req.nextUrl.searchParams;
    const limit = Math.min(500, Math.max(1, Number(sp.get("limit") ?? 200)));

    const [rows, users] = await Promise.all([
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit),
      listUsers(),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));

    return NextResponse.json({
      logs: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        username: r.userId ? userMap.get(r.userId)?.username ?? null : null,
        displayName: r.userId ? userMap.get(r.userId)?.displayName ?? null : null,
        action: r.action,
        actionLabel: ACTION_LABELS[r.action] ?? r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        detail: r.detail,
        createdAt: r.createdAt.getTime(),
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `获取日志失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
