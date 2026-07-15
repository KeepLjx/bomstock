import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { getMaterialDetail } from "@/lib/inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 查询某物料编码的全部相关数据：基线库存 + 来自哪些 occupied BOM 的需求明细。
 * 用于「实时库存」物料编码悬浮/点击查看详情。
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const code = (sp.get("code") ?? "").trim();
    if (!code) {
      return NextResponse.json({ error: "缺少 code 参数" }, { status: 400 });
    }
    const runPhase3 = sp.get("phase3");
    const detail = await getMaterialDetail(
      code,
      runPhase3 === null ? true : runPhase3 !== "false",
    );
    return NextResponse.json(detail);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    console.error("[/api/inventory/material-detail] 查询物料明细失败:", e);
    return NextResponse.json(
      { error: `查询物料明细失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
