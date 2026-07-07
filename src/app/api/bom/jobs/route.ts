import { NextResponse } from "next/server";
import { listJobs } from "@/lib/bom/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const jobs = await listJobs(30);
  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      createdAt: j.createdAt,
      outputFileName: j.outputFileName,
      summary: j.summary,
      files: (j.files ?? []).map((f) => ({
        originalName: f.originalName,
        kind: f.kind,
        role: f.role,
      })),
      error: j.error,
    })),
  });
}
