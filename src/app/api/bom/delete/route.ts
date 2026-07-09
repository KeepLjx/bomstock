import { NextRequest, NextResponse } from "next/server";
import { loadJob, updateJob, removeJobFile } from "@/lib/bom/storage";
import { parsedFileToDTO } from "@/lib/bom/dto";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
interface DeleteBody {
  jobId: string;
  storedName: string;
}
/** 从任务中移除指定文件（同时删除磁盘上的 xlsx / csv） */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteBody;
    const { jobId, storedName } = body;
    if (!jobId || !storedName) {
      return NextResponse.json(
        { error: "缺少 jobId 或 storedName" },
        { status: 400 },
      );
    }
    const state = await loadJob(jobId);
    if (!state) {
      return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    }
    const file = state.files.find((f) => f.storedName === storedName);
    if (!file) {
      return NextResponse.json({ error: "未找到对应文件" }, { status: 404 });
    }
    // 删除磁盘文件：原始 Excel + 清洗后的 CSV
    removeJobFile(jobId, file.storedName);
    if (file.csvName) removeJobFile(jobId, file.csvName);
    const nextFiles = state.files.filter((f) => f.storedName !== storedName);
    await updateJob(jobId, file.originalName, {
      status: state.status,
      files: nextFiles,
    });
    return NextResponse.json({
      jobId,
      files: nextFiles.map(parsedFileToDTO),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `删除文件失败：${message}` },
      { status: 500 },
    );
  }
}