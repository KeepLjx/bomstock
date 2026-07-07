import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { db } from "@/db";
import { bomJobs } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import type { JobState, ParsedFile, WorkflowConfig, WorkflowSummary } from "./types";

// ============================================================================
// 任务存储：磁盘文件 + PostgreSQL 状态
// ============================================================================

const ROOT = process.env.BOM_STORAGE_DIR || path.join(os.tmpdir(), "bom-jobs");

/** 确保任务目录存在 */
export function ensureJobDir(jobId: string): string {
  const dir = path.join(ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function jobDir(jobId: string): string {
  return path.join(ROOT, jobId);
}

/** 生成任务 ID */
export function generateJobId(): string {
  return crypto.randomBytes(8).toString("hex") + Date.now().toString(36);
}

/** 写入上传文件到任务目录，返回存储名与路径 */
export function saveUpload(
  jobId: string,
  originalName: string,
  buffer: Buffer,
): { storedName: string; filePath: string } {
  const dir = ensureJobDir(jobId);
  const safe = originalName.replace(/[^\w.\u4e00-\u9fa5\-]/g, "_");
  const storedName = `${crypto.randomBytes(4).toString("hex")}_${safe}`;
  const filePath = path.join(dir, storedName);
  fs.writeFileSync(filePath, buffer);
  return { storedName, filePath };
}

export function filePathOf(jobId: string, storedName: string): string {
  return path.join(jobDir(jobId), storedName);
}

export function fileExists(jobId: string, storedName: string): boolean {
  try {
    return fs.existsSync(filePathOf(jobId, storedName));
  } catch {
    return false;
  }
}

/** 从 JobState 构建可入库的记录 */
function stateToRow(jobId: string, name: string, state: JobState) {
  return {
    id: jobId,
    name,
    status: state.status,
    files: state.files as unknown,
    config: (state.config ?? null) as unknown,
    summary: (state.summary ?? null) as unknown,
    outputFileName: state.outputFileName ?? null,
    error: state.error ?? null,
    updatedAt: new Date(),
  };
}

/** 创建任务（插入数据库） */
export async function createJob(jobId: string, name: string, state: JobState): Promise<void> {
  await db
    .insert(bomJobs)
    .values(stateToRow(jobId, name, state))
    .onConflictDoNothing();
}

/** 更新任务状态 */
export async function updateJob(
  jobId: string,
  name: string,
  patch: Partial<JobState>,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.files !== undefined) set.files = patch.files as unknown;
  if (patch.config !== undefined) set.config = patch.config as unknown;
  if (patch.summary !== undefined) set.summary = patch.summary as unknown;
  if (patch.outputFileName !== undefined) set.outputFileName = patch.outputFileName;
  if (patch.error !== undefined) set.error = patch.error;
  await db
    .update(bomJobs)
    .set(set)
    .where(eq(bomJobs.id, jobId));
}

/** 读取任务状态 */
export async function loadJob(jobId: string): Promise<JobState | null> {
  const rows = await db.select().from(bomJobs).where(eq(bomJobs.id, jobId)).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    status: (r.status as JobState["status"]) ?? "parsed",
    files: (r.files as ParsedFile[]) ?? [],
    config: (r.config as WorkflowConfig | undefined) ?? undefined,
    summary: (r.summary as WorkflowSummary | undefined) ?? undefined,
    outputFileName: r.outputFileName ?? undefined,
    error: r.error ?? undefined,
    createdAt: r.createdAt.getTime(),
  };
}

/** 列出最近任务 */
export async function listJobs(limit = 20): Promise<JobState[]> {
  const rows = await db
    .select()
    .from(bomJobs)
    .orderBy(desc(bomJobs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    status: (r.status as JobState["status"]) ?? "parsed",
    files: (r.files as ParsedFile[]) ?? [],
    config: (r.config as WorkflowConfig | undefined) ?? undefined,
    summary: (r.summary as WorkflowSummary | undefined) ?? undefined,
    outputFileName: r.outputFileName ?? undefined,
    error: r.error ?? undefined,
    createdAt: r.createdAt.getTime(),
  }));
}
