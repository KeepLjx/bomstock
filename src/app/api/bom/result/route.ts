import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { db } from "@/db";
import { bomJobs } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 获取某 BOM 匹配任务处理后的结果表格（含插入分析列与颜色标记） */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });
    }
    const rows = await db
      .select({ result: bomJobs.result, summary: bomJobs.summary, name: bomJobs.name, outputFileName: bomJobs.outputFileName })
      .from(bomJobs)
      .where(eq(bomJobs.id, jobId))
      .limit(1);
    const r = rows[0];
    if (!r) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    if (!r.result) {
      return NextResponse.json(
        { error: "该任务暂无匹配结果（可能是在新功能前处理的，请重新匹配）" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      table: r.result,
      summary: r.summary,
      name: r.name,
      outputFileName: r.outputFileName,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `获取结果失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
