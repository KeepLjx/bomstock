import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { calculateRealtime } from "@/lib/inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const runPhase3 = sp.get("phase3");
    const result = await calculateRealtime({
      runPhase3: runPhase3 === null ? true : runPhase3 !== "false",
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `实时库存计算失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
