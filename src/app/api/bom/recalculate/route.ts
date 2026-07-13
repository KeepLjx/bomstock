import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { calculateRealtime } from "@/lib/inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 模拟重新扣减计算。
 * body: { jobIds?: string[], runPhase3?: boolean }
 * - 不传 jobIds：使用全部 active occupied BOM（全局口径）
 * - 传 jobIds：仅模拟这些作业的扣减（不改全局 active 集合）
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const jobIds = Array.isArray(body.jobIds)
      ? body.jobIds.map((x: unknown) => String(x)).filter(Boolean)
      : undefined;
    const runPhase3 = body.runPhase3 !== false;

    const result = await calculateRealtime({
      selectedJobIds: jobIds,
      runPhase3,
    });

    await writeAudit({
      userId: user.id,
      action: "recalculate",
      detail: {
        jobIds: jobIds ?? "all-active",
        runPhase3,
        materialCount: result.materialCount,
        shortageCount: result.shortageCount,
      },
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `重新计算失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
