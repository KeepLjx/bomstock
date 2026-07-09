import path from "node:path";
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { loadJob, jobDir } from "@/lib/bom/storage";
import { readCSV } from "@/lib/bom/csv";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
interface PreviewBody {
  jobId: string;
  storedName: string;
  limit?: number;
}
/**
 * 返回某文件当前工作表的预览数据（基于清洗后的 CSV）。
 * 用于「点击表名 -> 弹窗预览」，前端可调整列宽/行高。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PreviewBody;
    const { jobId, storedName } = body;
    if (!jobId || !storedName) {
      return NextResponse.json(
        { error: "缺少 jobId 或 storedName" },
        { status: 400 },
      );
    }
    const limit = Math.min(
      Math.max(1, Number(body.limit) || DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    const state = await loadJob(jobId);
    if (!state) {
      return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    }
    const file = state.files.find((f) => f.storedName === storedName);
    if (!file) {
      return NextResponse.json({ error: "未找到对应文件" }, { status: 404 });
    }
    const csvName =
      file.csvName ??
      `${storedName.replace(/\.(xlsx|xlsm|xls)$/i, "")}.csv`;
    const csvPath = path.join(jobDir(jobId), csvName);
    if (!fs.existsSync(csvPath)) {
      return NextResponse.json(
        { error: "预览数据不存在，请重新上传该文件" },
        { status: 404 },
      );
    }
    const table = readCSV(csvPath);
    const rows = table.rows.slice(0, limit);
    return NextResponse.json({
      columns: table.columns,
      rows,
      totalRows: table.rowCount,
      limited: rows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `获取预览失败：${message}` },
      { status: 500 },
    );
  }
}
