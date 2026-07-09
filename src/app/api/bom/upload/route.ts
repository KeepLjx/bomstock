import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import {
  generateJobId,
  saveUpload,
  createJob,
  updateJob,
  loadJob,
  jobDir,
  saveResourceUpload,
  upsertResource,
  resourceFilePath,
} from "@/lib/bom/storage";
import { parsedFileToDTO } from "@/lib/bom/dto";
import {
  cleanExcelToCSV,
  detectFileKind,
  detectBomRole,
  detectSetsFromCSV,
} from "@/lib/bom/parse";
import type { ParsedFile, JobState } from "@/lib/bom/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_FILES = 10;
const MAX_SIZE = 60 * 1024 * 1024; // 60MB
/** 解析单个 BOM 文件为 ParsedFile（保存到任务目录 + 清洗 CSV + 识别类型/角色/套数）。 */
async function parseBom(jobId: string, dir: string, f: File): Promise<ParsedFile> {
  const buf = Buffer.from(await f.arrayBuffer());
  const { storedName, filePath } = saveUpload(jobId, f.name, buf);
  const csvName = `${storedName.replace(/\.(xlsx|xlsm|xls)$/i, "")}.csv`;
  const csvPath = path.join(dir, csvName);
  const cleaned = await cleanExcelToCSV(filePath, csvPath);
  const kind = detectFileKind(f.name, cleaned.columns);
  const role = kind === "bom" ? detectBomRole(f.name) : undefined;
  const meta: ParsedFile = {
    storedName,
    originalName: f.name,
    size: f.size,
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
  return meta;
}
/** 计算缺一博物料编码的告警文案（仅针对任务内的 BOM 文件） */
function buildYiboWarning(files: ParsedFile[]): string | null {
  const bomFiles = files.filter((p) => p.kind === "bom");
  const missingYibo = bomFiles.filter((p) => !p.hasYiboCode);
  if (missingYibo.length === 0) return null;
  return `检测到部分 BOM 文件缺少「一博物料编码」列：${missingYibo
    .map((m) => m.originalName)
    .join("、")}。缺少该列将无法获取一博库存信息，供料方式无法完整判定，请替换为含该列的文件。`;
}
/**
 * 将库存/工单文件解析并持久化为全局资源（覆盖旧版本）。
 * 直接清洗到资源目录，更新数据库 updatedAt。
 */
async function persistResource(
  id: "inventory" | "work_order",
  f: File,
): Promise<ParsedFile> {
  const buf = Buffer.from(await f.arrayBuffer());
  const { storedName, filePath } = saveResourceUpload(f.name, buf);
  const csvName = `${storedName.replace(/\.(xlsx|xlsm|xls)$/i, "")}.csv`;
  const csvPath = resourceFilePath(csvName);
  const cleaned = await cleanExcelToCSV(filePath, csvPath);
  const meta: ParsedFile = {
    storedName,
    originalName: f.name,
    size: f.size,
    kind: id === "inventory" ? "inventory" : "transfer",
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
  await upsertResource(id, id, storedName, f.name, meta);
  return meta;
}
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    const rawJobId = form.get("jobId");
    const appendJobId =
      typeof rawJobId === "string" && rawJobId.trim() ? rawJobId.trim() : null;
    if (files.length === 0) {
      return NextResponse.json(
        { error: "请至少上传一个 Excel 文件（.xlsx）" },
        { status: 400 },
      );
    }
    for (const f of files) {
      if (f.size > MAX_SIZE) {
        return NextResponse.json(
          { error: `文件 ${f.name} 超过 ${MAX_SIZE / 1024 / 1024}MB 限制` },
          { status: 400 },
        );
      }
      if (!/\.(xlsx|xlsm|xls)$/.test(f.name.toLowerCase())) {
        return NextResponse.json(
          { error: `文件 ${f.name} 不是 Excel 文件，仅支持 .xlsx/.xlsm` },
          { status: 400 },
        );
      }
    }
    let existingFiles: ParsedFile[] = [];
    if (appendJobId) {
      const state = await loadJob(appendJobId);
      if (state) existingFiles = state.files;
    }
    const jobId = appendJobId ?? generateJobId();
    const dir = jobDir(jobId);
    const parsedFiles: ParsedFile[] = [...existingFiles];
    const updatedResources: {
      kind: "inventory" | "work_order";
      file: ReturnType<typeof parsedFileToDTO>;
    }[] = [];
    for (const f of files) {
      let meta: ParsedFile;
      try {
        // 先解析到任务目录以识别类型
        meta = await parseBom(jobId, dir, f);
      } catch (e) {
        return NextResponse.json(
          { error: `解析文件 ${f.name} 失败：${(e as Error).message}` },
          { status: 400 },
        );
      }
      // 需求 5.3：库存表 / 工单表上传视为「更新持久资源」，不并入 BOM 任务
      if (meta.kind === "inventory") {
        const resMeta = await persistResource("inventory", f);
        // 清理任务目录中的临时副本
        cleanupTemp(dir, meta.storedName, meta.csvName);
        updatedResources.push({ kind: "inventory", file: parsedFileToDTO(resMeta) });
      } else if (meta.kind === "transfer" || meta.kind === "bills") {
        const resMeta = await persistResource("work_order", f);
        cleanupTemp(dir, meta.storedName, meta.csvName);
        updatedResources.push({ kind: "work_order", file: parsedFileToDTO(resMeta) });
      } else {
        parsedFiles.push(meta);
      }
    }
    if (parsedFiles.length > MAX_FILES) {
      return NextResponse.json(
        { error: `最多同时上传 ${MAX_FILES} 个 BOM 文件` },
        { status: 400 },
      );
    }
    const yiboWarning = buildYiboWarning(parsedFiles);
    if (parsedFiles.length > 0) {
      const state: JobState = {
        id: jobId,
        status: "parsed",
        files: parsedFiles,
        createdAt: Date.now(),
      };
      if (appendJobId && existingFiles.length > 0) {
        await updateJob(jobId, parsedFiles[0]?.originalName ?? "BOM任务", {
          status: "parsed",
          files: parsedFiles,
        });
      } else {
        await createJob(jobId, parsedFiles[0]?.originalName ?? "BOM任务", state);
      }
    }
    return NextResponse.json({
      jobId,
      files: parsedFiles.map(parsedFileToDTO),
      yiboWarning,
      updatedResources,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `上传失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
/** 清理任务目录中被提升为持久资源的临时文件 */
function cleanupTemp(dir: string, storedName?: string, csvName?: string): void {
  try {
    if (storedName) {
      const p = path.join(dir, storedName);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (csvName) {
      const p = path.join(dir, csvName);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch {
    // 忽略
  }
}