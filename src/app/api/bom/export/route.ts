import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { ensureJobDir, filePathOf } from "@/lib/bom/storage";
import { applyEditsToWorkbook } from "@/lib/bom/excel-writer";
import type { TableData } from "@/lib/bom/types";
import fs from "node:fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ExportBody {
  jobId: string;
  table: TableData;
  /** 基础输出文件名（含原始样式的生成结果），在其上应用编辑 */
  outputFileName: string;
  baseName?: string;
}

/**
 * 接收前端编辑后的表格数据，在「原始样式输出 XLSX」上应用编辑（值 + 颜色），
 * 保留原始字体/列宽/合并单元格/空列等样式，返回新文件。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportBody;
    const { jobId, table } = body;
    if (!jobId) {
      return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });
    }
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
      return NextResponse.json(
        { error: "表格数据不完整（缺少 columns/rows）" },
        { status: 400 },
      );
    }
    if (!body.outputFileName) {
      return NextResponse.json(
        { error: "缺少基础输出文件 outputFileName" },
        { status: 400 },
      );
    }

    const sourcePath = filePathOf(jobId, body.outputFileName);
    if (!fs.existsSync(sourcePath)) {
      return NextResponse.json(
        { error: "基础输出文件不存在，请重新执行匹配" },
        { status: 404 },
      );
    }

    const dir = ensureJobDir(jobId);
    const base =
      (body.baseName || "BOM供料方式").replace(/\.(xlsx|xlsm|xls)$/i, "") ||
      "BOM供料方式";
    const outName = `${base}_编辑_${Date.now()}.xlsx`;
    const outPath = path.join(dir, outName);

    await applyEditsToWorkbook(sourcePath, table, outPath);

    return NextResponse.json({ outputFileName: outName, jobId });
  } catch (e) {
    return NextResponse.json(
      { error: `导出失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
