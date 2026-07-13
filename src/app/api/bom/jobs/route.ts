import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bomJobs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser, UnauthorizedError } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KIND_LABELS: Record<string, string> = {
  bom: "BOM",
  inventory: "库存表",
  bills: "单据",
  transfer: "调拨",
};

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const jobType = sp.get("job_type"); // occupied_bom | target_bom | undefined

    let query = db.select().from(bomJobs).orderBy(desc(bomJobs.createdAt)).limit(50);
    const rows =
      jobType === "occupied_bom" || jobType === "target_bom"
        ? await db
            .select()
            .from(bomJobs)
            .where(eq(bomJobs.jobType, jobType))
            .orderBy(desc(bomJobs.createdAt))
            .limit(50)
        : await query;

    return NextResponse.json({
      jobs: rows.map((j) => {
        const files = (j.files ?? []) as { originalName: string; kind: string; role?: string }[];
        return {
          id: j.id,
          name: j.name,
          status: j.status,
          jobType: j.jobType,
          uploadedBy: j.uploadedBy,
          fileHash: j.fileHash,
          bizKey: j.bizKey,
          sets: j.sets,
          deductionStatus: j.deductionStatus,
          duplicateOfJobId: j.duplicateOfJobId,
          replacedByJobId: j.replacedByJobId,
          reservedAt: j.reservedAt ? j.reservedAt.toISOString() : null,
          createdAt: j.createdAt.getTime(),
          outputFileName: j.outputFileName,
          summary: j.summary,
          files: files.map((f) => ({
            originalName: f.originalName,
            kind: KIND_LABELS[f.kind] ?? f.kind,
            role: f.role,
          })),
          error: j.error,
        };
      }),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `获取任务列表失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
