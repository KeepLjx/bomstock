import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  loadJob,
  updateJob,
  removeJobFile,
  saveUpload,
  jobDir,
} from "@/lib/bom/storage";
import { parsedFileToDTO } from "@/lib/bom/dto";
import {
  cleanExcelToCSV,
  detectFileKind,
  detectBomRole,
  detectSetsFromCSV,
} from "@/lib/bom/parse";
import type { ParsedFile } from "@/lib/bom/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * 原子替换：用新文件替换任务中指定位置的旧文件（保持其在列表中的顺序）。
 * 接收 formData：jobId、replaceStoredName（旧文件）、files（新文件，单个）
 * 后端完成：删除旧文件(磁盘+csv) → 解析新文件 → 原位置替换 → 更新数据库。
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const jobId = String(form.get("jobId") ?? "").trim();
    const replaceStoredName = String(form.get("replaceStoredName") ?? "").trim();
    const file = form.getAll("files").find((f): f is File => f instanceof File);
    if (!jobId || !replaceStoredName) {
      return NextResponse.json(
        { error: "缺少 jobId 或 replaceStoredName" },
        { status: 400 },
      );
    }
    if (!file) {
      return NextResponse.json({ error: "请选择替换文件" }, { status: 400 });
    }
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      return NextResponse.json(
        { error: `文件 ${file.name} 不是 Excel 文件，仅支持 .xlsx/.xlsm` },
        { status: 400 },
      );
    }
    const state = await loadJob(jobId);
    if (!state) {
      return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    }
    // 定位旧文件及其在列表中的位置（用于保持顺序）
    const oldIndex = state.files.findIndex(
      (f) => f.storedName === replaceStoredName,
    );
    if (oldIndex < 0) {
      return NextResponse.json(
        { error: "未找到要替换的文件" },
        { status: 404 },
      );
    }
    const oldFile = state.files[oldIndex];
    // 1) 删除旧文件（原始 Excel + 清洗后的 CSV）
    removeJobFile(jobId, oldFile.storedName);
    if (oldFile.csvName) removeJobFile(jobId, oldFile.csvName);
    // 2) 保存并解析新文件
    const buf = Buffer.from(await file.arrayBuffer());
    const dir = jobDir(jobId);
    const { storedName, filePath } = saveUpload(jobId, file.name, buf);
    const csvName = `${storedName.replace(/\.(xlsx|xlsm|xls)$/i, "")}.csv`;
    const csvPath = path.join(dir, csvName);
    const cleaned = await cleanExcelToCSV(filePath, csvPath);
    const kind = detectFileKind(file.name, cleaned.columns);
    const role = kind === "bom" ? detectBomRole(file.name) : undefined;
    const meta: ParsedFile = {
      storedName,
      originalName: file.name,
      size: file.size,
      kind,
      role,
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
    try {
      meta.detectedSets = await detectSetsFromCSV(csvPath, meta.headers);
    } catch {
      meta.detectedSets = null;
    }
    // 3) 在原位置替换（数组保持顺序，前端无需重排）
    const nextFiles = [...state.files];
    nextFiles[oldIndex] = meta;
    await updateJob(jobId, nextFiles[0]?.originalName ?? file.name, {
      status: state.status,
      files: nextFiles,
    });
    return NextResponse.json({
      jobId,
      files: nextFiles.map(parsedFileToDTO),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `替换失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}