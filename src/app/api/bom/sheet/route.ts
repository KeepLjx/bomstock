import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { loadJob, updateJob, filePathOf, jobDir } from "@/lib/bom/storage";
import { cleanExcelToCSV } from "@/lib/bom/parse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SheetBody {
  jobId: string;
  storedName: string;
  sheetName: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SheetBody;
    const { jobId, storedName, sheetName } = body;
    if (!jobId || !storedName || !sheetName) {
      return NextResponse.json(
        { error: "缺少 jobId、storedName 或 sheetName" },
        { status: 400 },
      );
    }

    const state = await loadJob(jobId);
    if (!state) {
      return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    }

    const index = state.files.findIndex((file) => file.storedName === storedName);
    if (index < 0) {
      return NextResponse.json({ error: "未找到对应文件" }, { status: 404 });
    }

    const currentFile = state.files[index];
    if (!currentFile.sheets.includes(sheetName)) {
      return NextResponse.json({ error: "目标 sheet 不存在" }, { status: 400 });
    }

    const csvName =
      currentFile.csvName ??
      `${storedName.replace(/\.(xlsx|xlsm|xls)$/i, "")}_${Date.now()}.csv`;
    const csvPath = path.join(jobDir(jobId), csvName);
    const sourcePath = filePathOf(jobId, storedName);
    const cleaned = await cleanExcelToCSV(sourcePath, csvPath, sheetName);

    const nextFile = {
      ...currentFile,
      sheets: cleaned.sheets,
      mainSheet: cleaned.mainSheet,
      rowCount: cleaned.rowCount,
      headerRow: cleaned.headerRow,
      headers: cleaned.columns,
      headerMap: cleaned.headerMap,
      hasYiboCode: cleaned.hasYiboCode,
      csvName,
      removedColumnCount: cleaned.removedColumnCount,
      ignoredChangeLog: cleaned.ignoredChangeLog,
    };

    const nextFiles = [...state.files];
    nextFiles[index] = nextFile;
    await updateJob(jobId, currentFile.originalName, {
      status: state.status,
      files: nextFiles,
    });

    return NextResponse.json({
      file: {
        storedName: nextFile.storedName,
        originalName: nextFile.originalName,
        kind: nextFile.kind,
        role: nextFile.role,
        hasYiboCode: nextFile.hasYiboCode,
        rowCount: nextFile.rowCount,
        headerRow: nextFile.headerRow,
        mainSheet: nextFile.mainSheet,
        sheets: nextFile.sheets,
        removedColumnCount: nextFile.removedColumnCount ?? 0,
        ignoredChangeLog: nextFile.ignoredChangeLog ?? [],
        headers: Object.entries(nextFile.headers)
          .map(([col, name]) => ({ col: Number(col), name }))
          .sort((a, b) => a.col - b.col),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `切换 sheet 失败：${message}` },
      { status: 500 },
    );
  }
}
