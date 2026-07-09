import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  generateJobId,
  saveUpload,
  createJob,
  updateJob,
  loadJob,
  jobDir,
} from "@/lib/bom/storage";
import { parsedFileToDTO } from "@/lib/bom/dto";
import {
  cleanExcelToCSV,
  detectFileKind,
  detectBomRole,
} from "@/lib/bom/parse";
import type { ParsedFile, JobState } from "@/lib/bom/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_FILES = 10;
const MAX_SIZE = 60 * 1024 * 1024; // 60MB
/**
 * 解析单个文件为 ParsedFile（保存到磁盘 + 清洗为 CSV + 识别类型/角色）。
 * 抽出以便「初次上传」与「追加」复用同一逻辑。
 */
async function parseOne(
  jobId: string,
  dir: string,
  f: File,
): Promise<ParsedFile> {
  const buf = Buffer.from(await f.arrayBuffer());
  const { storedName, filePath } = saveUpload(jobId, f.name, buf);
  // 清洗 -> CSV（忽略 change log、剔除空列/纯色列）
  const csvName = `${storedName.replace(/\.(xlsx|xlsm|xls)$/i, "")}.csv`;
  const csvPath = path.join(dir, csvName);
  const cleaned = await cleanExcelToCSV(filePath, csvPath);
  const kind = detectFileKind(f.name, cleaned.columns);
  const role = kind === "bom" ? detectBomRole(f.name) : undefined;
  return {
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
}
/** 计算缺一博物料编码的告警文案 */
function buildYiboWarning(files: ParsedFile[]): string | null {
  const bomFiles = files.filter((p) => p.kind === "bom");
  const missingYibo = bomFiles.filter((p) => !p.hasYiboCode);
  if (missingYibo.length === 0) return null;
  return `检测到部分 BOM 文件缺少「一博物料编码」列：${missingYibo
    .map((m) => m.originalName)
    .join("、")}。缺少该列将无法获取一博库存信息，供料方式无法完整判定，请替换为含该列的文件。`;
}
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    // 可选 jobId：若提供且任务存在，则为「追加」模式（向同一任务补充文件）
    const rawJobId = form.get("jobId");
    const appendJobId =
      typeof rawJobId === "string" && rawJobId.trim() ? rawJobId.trim() : null;
    if (files.length === 0) {
      return NextResponse.json(
        { error: "请至少上传一个 Excel 文件（.xlsx）" },
        { status: 400 },
      );
    }
    // 校验新上传文件
    for (const f of files) {
      if (f.size > MAX_SIZE) {
        return NextResponse.json(
          { error: `文件 ${f.name} 超过 ${MAX_SIZE / 1024 / 1024}MB 限制` },
          { status: 400 },
        );
      }
      const lower = f.name.toLowerCase();
      if (!/\.(xlsx|xlsm|xls)$/.test(lower)) {
        return NextResponse.json(
          { error: `文件 ${f.name} 不是 Excel 文件，仅支持 .xlsx/.xlsm` },
          { status: 400 },
        );
      }
    }
    // 加载已有任务（追加模式）
    let existingFiles: ParsedFile[] = [];
    if (appendJobId) {
      const state = await loadJob(appendJobId);
      if (state) existingFiles = state.files;
    }
    if (existingFiles.length + files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `最多同时上传 ${MAX_FILES} 个文件，当前已有 ${existingFiles.length} 个` },
        { status: 400 },
      );
    }
    const jobId = appendJobId ?? generateJobId();
    const dir = jobDir(jobId);
    const parsedFiles: ParsedFile[] = [...existingFiles];
    for (const f of files) {
      try {
        parsedFiles.push(await parseOne(jobId, dir, f));
      } catch (e) {
        return NextResponse.json(
          { error: `解析文件 ${f.name} 失败：${(e as Error).message}` },
          { status: 400 },
        );
      }
    }
    const yiboWarning = buildYiboWarning(parsedFiles);
    const state: JobState = {
      id: jobId,
      status: "parsed",
      files: parsedFiles,
      createdAt: Date.now(),
    };
    if (appendJobId && existingFiles.length > 0) {
      // 追加：更新已有任务的文件列表
      await updateJob(jobId, parsedFiles[0]?.originalName ?? "BOM任务", {
        status: "parsed",
        files: parsedFiles,
      });
    } else {
      await createJob(jobId, parsedFiles[0]?.originalName ?? "BOM任务", state);
    }
    return NextResponse.json({
      jobId,
      files: parsedFiles.map(parsedFileToDTO),
      yiboWarning,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `上传失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}