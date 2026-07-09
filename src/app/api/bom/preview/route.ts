import path from "node:path";
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { loadJob, jobDir, resourceFilePath, getResource } from "@/lib/bom/storage";
import { readCSV } from "@/lib/bom/csv";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
interface PreviewBody {
  jobId?: string;
  storedName?: string;
  /** 预览持久资源：inventory | work_order（与 storedName 二选一） */
  kind?: "inventory" | "work_order";
  limit?: number;
}
/**
 * 返回某文件当前工作表的预览数据（基于清洗后的 CSV）。
 * 用于「点击表名 -> 弹窗预览」，前端可调整列宽/行高。
 * 支持：任务内文件（jobId+storedName）或持久资源（kind）。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PreviewBody;
    const limit = Math.min(
      Math.max(1, Number(body.limit) || DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    let csvPath: string | null = null;
    if (body.kind === "inventory" || body.kind === "work_order") {
      // 持久资源预览
      const id = body.kind === "inventory" ? "inventory" : "work_order";
      const res = await getResource(id);
      if (!res) {
        return NextResponse.json({ error: "该资源尚未上传" }, { status: 404 });
      }
      const csvName = res.meta.csvName;
      if (!csvName) {
        return NextResponse.json({ error: "资源缺少预览数据" }, { status: 404 });
      }
      csvPath = resourceFilePath(csvName);
    } else {
      // 任务内文件预览
      const { jobId, storedName } = body;
      if (!jobId || !storedName) {
        return NextResponse.json(
          { error: "缺少 jobId+storedName 或 kind" },
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
      const csvName =
        file.csvName ??
        `${storedName.replace(/\.(xlsx|xlsm|xls)$/i, "")}.csv`;
      csvPath = path.join(jobDir(jobId), csvName);
    }
    if (!csvPath || !fs.existsSync(csvPath)) {
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