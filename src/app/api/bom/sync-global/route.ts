import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { setJobDeductionStatus, type DeductionStatus } from "@/lib/bom/store";
import { db } from "@/db";
import { bomJobs } from "@/db/schema";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface UpdateItem {
  jobId: string;
  status: "active" | "inactive";
}

/**
 * 将「实时库存」页中物料/作业的勾选状态同步为全局扣减状态：
 * 勾选 -> active，未勾选 -> inactive。
 * 仅作用于 occupied_bom，跳过 replaced/duplicate 终态。
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body.updates) ? body.updates : [];

    const valid: UpdateItem[] = raw.filter(
      (u: unknown): u is UpdateItem =>
        !!u &&
        typeof (u as UpdateItem).jobId === "string" &&
        ((u as UpdateItem).status === "active" || (u as UpdateItem).status === "inactive"),
    );

    if (valid.length === 0) {
      return NextResponse.json({ error: "无有效更新项" }, { status: 400 });
    }

    const ids = valid.map((u) => u.jobId);
    const rows = await db.select().from(bomJobs).where(inArray(bomJobs.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));

    let changed = 0;
    const applied: UpdateItem[] = [];
    for (const u of valid) {
      const job = byId.get(u.jobId);
      if (!job || job.jobType !== "occupied_bom") continue;
      const status = job.deductionStatus ?? "active";
      // 终态（replaced/duplicate）不可再改
      if (status === "replaced" || status === "duplicate") continue;
      if (status === u.status) continue;
      await setJobDeductionStatus(u.jobId, u.status as DeductionStatus);
      applied.push(u);
      changed += 1;
    }

    await writeAudit({
      userId: user.id,
      action: "toggle_active",
      targetType: "job",
      targetId: null,
      detail: { sync: true, changed, applied },
    });

    return NextResponse.json({ ok: true, changed, applied });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `同步失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
