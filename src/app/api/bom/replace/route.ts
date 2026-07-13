import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  loadJob,
  updateJob,
  jobDir,
  saveUpload,
  removeJobFile,
} from "@/lib/bom/storage";
import {
  cleanExcelToCSV,
  detectFileKind,
  detectBomRole,
  detectSetsFromCSV,
} from "@/lib/bom/parse";
import { parsedFileToDTO } from "@/lib/bom/dto";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { markReplaced, setJobDeductionStatus } from "@/lib/bom/store";
import { db } from "@/db";
import { bomJobs } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { ParsedFile } from "@/lib/bom/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SIZE = 60 * 1024 * 1024;

/** 解析单个文件为 ParsedFile（任务目录 + 清洗 CSV + 识别类型/角色/套数） */
async function parseFile(jobId: string, dir: string, f: File): Promise<ParsedFile> {
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

/**
 * 双模式：
 *  - multipart/form-data（旧 / Wizard）：替换任务内某个文件，返回 { files }
 *  - application/json（新系统）：biz_key 版本替换，旧 active 标记 replaced
 */
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>> | null = null;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return legacyFileReplace(req, user);
  }
  return bizKeyReplace(req, user);
}

/** 旧版：替换任务内某文件（Wizard 文件替换，保持原位置） */
async function legacyFileReplace(req: NextRequest, user: { id: string }) {
  try {
    const form = await req.formData();
    const jobId = String(form.get("jobId") ?? "");
    const replaceStoredName = String(form.get("replaceStoredName") ?? "");
    const file = form.getAll("files").find((f): f is File => f instanceof File);
    if (!jobId || !file) {
      return NextResponse.json({ error: "缺少 jobId 或文件" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `文件 ${file.name} 超过 ${MAX_SIZE / 1024 / 1024}MB 限制` },
        { status: 400 },
      );
    }
    const state = await loadJob(jobId);
    if (!state) {
      return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    }
    const dir = jobDir(jobId);
    // 解析新文件
    const meta = await parseFile(jobId, dir, file);
    // 删除被替换的旧文件（xlsx + csv）
    const old = state.files.find((f) => f.storedName === replaceStoredName);
    if (old) {
      removeJobFile(jobId, old.storedName);
      if (old.csvName) removeJobFile(jobId, old.csvName);
    }
    // 保持原位置替换
    const newFiles = [...state.files];
    const idx = newFiles.findIndex((f) => f.storedName === replaceStoredName);
    if (idx >= 0) newFiles[idx] = meta;
    else newFiles.push(meta);
    await updateJob(jobId, meta.originalName, {
      status: "parsed",
      files: newFiles,
    });
    await writeAudit({
      userId: user.id,
      action: "replace",
      targetType: "job",
      targetId: jobId,
      detail: { mode: "file", replaceStoredName, newName: file.name },
    });
    return NextResponse.json({ files: newFiles.map(parsedFileToDTO) });
  } catch (e) {
    return NextResponse.json(
      { error: `替换失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}

/** 新版：将指定 occupied BOM 设为该 biz_key 的当前版本（旧 active 标记 replaced） */
async function bizKeyReplace(req: NextRequest, user: { id: string }) {
  try {
    const body = await req.json().catch(() => ({}));
    const jobId = String(body.jobId ?? "");
    if (!jobId) {
      return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });
    }
    const rows = await db.select().from(bomJobs).where(eq(bomJobs.id, jobId)).limit(1);
    const job = rows[0];
    if (!job) {
      return NextResponse.json({ error: "作业不存在" }, { status: 404 });
    }
    if (job.jobType !== "occupied_bom") {
      return NextResponse.json(
        { error: "仅 occupied BOM 支持版本替换" },
        { status: 400 },
      );
    }
    if (!job.bizKey) {
      return NextResponse.json(
        { error: "该 BOM 缺少 biz_key，无法进行版本替换" },
        { status: 400 },
      );
    }
    const siblings = await db
      .select()
      .from(bomJobs)
      .where(
        and(
          eq(bomJobs.bizKey, job.bizKey),
          eq(bomJobs.jobType, "occupied_bom"),
          eq(bomJobs.deductionStatus, "active"),
        ),
      );
    const replacedIds: string[] = [];
    for (const s of siblings) {
      if (s.id === jobId) continue;
      await markReplaced(s.id, jobId);
      replacedIds.push(s.id);
    }
    await setJobDeductionStatus(jobId, "active", { reservedAt: new Date() });
    await writeAudit({
      userId: user.id,
      action: "replace",
      targetType: "job",
      targetId: jobId,
      detail: { mode: "biz_key", bizKey: job.bizKey, replacedIds, name: job.name },
    });
    return NextResponse.json({ ok: true, jobId, replacedIds });
  } catch (e) {
    return NextResponse.json(
      { error: `替换失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
