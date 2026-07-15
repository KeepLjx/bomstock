import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { deleteJobCascade } from "@/lib/bom/store";
import { removeJobDir } from "@/lib/bom/storage";
import { db } from "@/db";
import { bomJobs } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 删除整条 BOM 历史记录（occupied / target / workflow 均可）。
 * 级联清理：bom_demands（占用作业）+ bom_jobs 记录 + 磁盘文件目录。
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const jobId = String(body.jobId ?? "");

    if (!jobId) {
      return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });
    }

    const rows = await db.select().from(bomJobs).where(eq(bomJobs.id, jobId)).limit(1);
    const job = rows[0];
    if (!job) {
      return NextResponse.json({ error: "作业不存在或已删除" }, { status: 404 });
    }

    await deleteJobCascade(jobId);
    removeJobDir(jobId);

    await writeAudit({
      userId: user.id,
      action: "delete_job",
      targetType: "job",
      targetId: jobId,
      detail: {
        name: job.name,
        jobType: job.jobType,
        bizKey: job.bizKey,
        deductionStatus: job.deductionStatus,
      },
    });

    return NextResponse.json({ ok: true, jobId });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `删除失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
