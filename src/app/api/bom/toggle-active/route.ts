import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { setJobDeductionStatus } from "@/lib/bom/store";
import { db } from "@/db";
import { bomJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { DeductionStatus } from "@/lib/bom/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID: DeductionStatus[] = ["active", "inactive"];

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const jobId = String(body.jobId ?? "");
    const status = String(body.status ?? "") as DeductionStatus;

    if (!jobId) {
      return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });
    }
    if (!VALID.includes(status)) {
      return NextResponse.json(
        { error: "状态仅支持 active / inactive" },
        { status: 400 },
      );
    }

    const rows = await db
      .select()
      .from(bomJobs)
      .where(eq(bomJobs.id, jobId))
      .limit(1);
    const job = rows[0];
    if (!job) {
      return NextResponse.json({ error: "作业不存在" }, { status: 404 });
    }
    if (job.jobType !== "occupied_bom") {
      return NextResponse.json(
        { error: "仅 occupied BOM 支持启停扣减" },
        { status: 400 },
      );
    }

    await setJobDeductionStatus(jobId, status);
    await writeAudit({
      userId: user.id,
      action: "toggle_active",
      targetType: "job",
      targetId: jobId,
      detail: { status, name: job.name },
    });

    return NextResponse.json({ ok: true, jobId, status });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `操作失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
