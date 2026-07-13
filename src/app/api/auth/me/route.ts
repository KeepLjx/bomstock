import { NextRequest, NextResponse } from "next/server";
import { getRequestUser, ensureDefaultUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  await ensureDefaultUser();
  const user = await getRequestUser(req);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
  });
}
