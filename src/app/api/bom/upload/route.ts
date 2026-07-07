import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  generateJobId,
  saveUpload,
  createJob,
  jobDir,
} from "@/lib/bom/storage";
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

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "请至少上传一个 Excel 文件（.xlsx）" },
        { status: 400 },
      );
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `最多同时上传 ${MAX_FILES} 个文件` },
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
      const lower = f.name.toLowerCase();
      if (!/\.(xlsx|xlsm|xls)$/.test(lower)) {
        return NextResponse.json(
          { error: `文件 ${f.name} 不是 Excel 文件，仅支持 .xlsx/.xlsm` },
          { status: 400 },
        );
      }
    }

    const jobId = generateJobId();
    const dir = jobDir(jobId);
    const parsedFiles: ParsedFile[] = [];

    for (const f of files) {
      const buf = Buffer.from(await f.arrayBuffer());
      const { storedName, filePath } = saveUpload(jobId, f.name, buf);
      try {
        // 清洗 -> CSV（忽略 change log、剔除空列/纯色列）
        const csvName = `${storedName.replace(/\.(xlsx|xlsm|xls)$/i, "")}.csv`;
        const csvPath = path.join(dir, csvName);
        const cleaned = await cleanExcelToCSV(filePath, csvPath);

        const kind = detectFileKind(f.name, cleaned.columns);
        const role = kind === "bom" ? detectBomRole(f.name) : undefined;

        parsedFiles.push({
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
        });
      } catch (e) {
        return NextResponse.json(
          { error: `解析文件 ${f.name} 失败：${(e as Error).message}` },
          { status: 400 },
        );
      }
    }

    // 前置检查：BOM 文件是否含「一博物料编码」
    const bomFiles = parsedFiles.filter((p) => p.kind === "bom");
    const missingYibo = bomFiles.filter((p) => !p.hasYiboCode);
    const yiboWarning =
      missingYibo.length > 0
        ? `检测到部分 BOM 文件缺少「一博物料编码」列：${missingYibo
            .map((m) => m.originalName)
            .join("、")}。无法获取一博库存信息，供料方式将无法完整判定。`
        : null;

    const state: JobState = {
      id: jobId,
      status: "parsed",
      files: parsedFiles,
      createdAt: Date.now(),
    };

    await createJob(jobId, parsedFiles[0]?.originalName ?? "BOM任务", state);

    return NextResponse.json({
      jobId,
      files: parsedFiles.map((p) => ({
        storedName: p.storedName,
        originalName: p.originalName,
        kind: p.kind,
        role: p.role,
        hasYiboCode: p.hasYiboCode,
        rowCount: p.rowCount,
        headerRow: p.headerRow,
        mainSheet: p.mainSheet,
        sheets: p.sheets,
        removedColumnCount: p.removedColumnCount ?? 0,
        ignoredChangeLog: p.ignoredChangeLog ?? [],
        headers: Object.entries(p.headers)
          .map(([col, name]) => ({ col: Number(col), name }))
          .sort((a, b) => a.col - b.col),
      })),
      yiboWarning,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `上传失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}


