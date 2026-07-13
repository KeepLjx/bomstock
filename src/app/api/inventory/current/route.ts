import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { getCurrentInventory } from "@/lib/inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const current = await getCurrentInventory();
    return NextResponse.json({ current });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `获取当前库存失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
