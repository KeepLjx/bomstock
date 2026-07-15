import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { db } from "@/db";
import { bomJobs, bomResources } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import type { JobState, ParsedFile, WorkflowConfig, WorkflowSummary } from "./types";

// ============================================================================
// 任务存储：磁盘文件 + PostgreSQL 状态
// ============================================================================

const ROOT = process.env.BOM_STORAGE_DIR || path.join(os.tmpdir(), "bom-jobs");

// 持久化资源目录（库存表/工单调拨齐套报表长期保存于此）
const RESOURCE_ROOT = path.join(ROOT, "resoureces");
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
/** 删除任务目录中的指定文件（xlsx / csv 等） */
export function removeJobFile(jobId: string, storedName: string): void {
  try {
    const fp = filePathOf(jobId, storedName);
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch {
    // 忽略删除失败
  }
}

/** 删除整个任务目录（删除作业时清理磁盘） */
export function removeJobDir(jobId: string): void {
  try {
    const dir = jobDir(jobId);
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略删除失败
  }
}

/** 从 JobState 构建可入库的记录 */
function stateToRow(jobId: string, name: string, state: JobState) {
  const jsonb = (v: unknown) => (v === null ? null : sql`${JSON.stringify(v)}::jsonb`);
  return {
    id: jobId,
    name,
    status: state.status,
    files: jsonb(state.files),
    config: jsonb(state.config ?? null),
    summary: jsonb(state.summary ?? null),
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
  const jsonb = (v: unknown) => (v === null ? null : sql`${JSON.stringify(v)}::jsonb`);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.files !== undefined) set.files = jsonb(patch.files);
  if (patch.config !== undefined) set.config = jsonb(patch.config ?? null);
  if (patch.summary !== undefined) set.summary = jsonb(patch.summary ?? null);
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
// ============================================================================
// 持久化数据资源（库存表 / 工单调拨齐套报表）
// ============================================================================
const RESOURCE_DIR = path.join(RESOURCE_ROOT, "files");
function ensureResourceDir(): string {
  fs.mkdirSync(RESOURCE_DIR, { recursive: true });
  return RESOURCE_DIR;
}
/** 持久资源磁盘文件路径 */
export function resourceFilePath(storedName: string): string {
  return path.join(RESOURCE_DIR, storedName);
}
/** 将上传文件保存到持久资源目录，返回存储名与路径 */
export function saveResourceUpload(
  originalName: string,
  buffer: Buffer,
): { storedName: string; filePath: string } {
  const dir = ensureResourceDir();
  const safe = originalName.replace(/[^\w.\u4e00-\u9fa5\-]/g, "_");
  const storedName = `${crypto.randomBytes(4).toString("hex")}_${safe}`;
  const filePath = path.join(dir, storedName);
  fs.writeFileSync(filePath, buffer);
  return { storedName, filePath };
}
/** 写入/更新一条持久资源记录（同 id 覆盖） */
export async function upsertResource(
  id: string,
  kind: string,
  storedName: string,
  originalName: string,
  meta: ParsedFile,
): Promise<void> {
  await db
    .insert(bomResources)
    .values({ id, kind, storedName, originalName, meta: meta as unknown, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: bomResources.id,
      set: {
        kind,
        storedName,
        originalName,
        meta: meta as unknown,
        updatedAt: new Date(),
      },
    });
}
/** 读取单条资源 */
export async function getResource(id: string): Promise<{
  id: string;
  kind: string;
  storedName: string;
  originalName: string;
  meta: ParsedFile;
  updatedAt: Date;
} | null> {
  const rows = await db.select().from(bomResources).where(eq(bomResources.id, id)).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    kind: r.kind,
    storedName: r.storedName,
    originalName: r.originalName ?? "",
    meta: (r.meta as ParsedFile) ?? ({} as ParsedFile),
    updatedAt: r.updatedAt,
  };
}
/** 列出所有资源 */
export async function listResources() {
  const rows = await db.select().from(bomResources);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    storedName: r.storedName,
    originalName: r.originalName ?? "",
    meta: (r.meta as ParsedFile) ?? ({} as ParsedFile),
    updatedAt: r.updatedAt,
  }));
}
/**
 * 将持久资源「链接」进某任务目录（仅拷贝清洗后的 CSV，供编排器读取）。
 * 返回可在该任务内解析的 ParsedFile（storedName / csvName 与任务目录一致）。
 */
export function linkResourceToJob(jobId: string, resource: {
  storedName: string;
  originalName: string;
  meta: ParsedFile;
}): ParsedFile {
  const dir = ensureJobDir(jobId);
  const meta = resource.meta;
  // 拷贝 CSV（编排器基于 CSV 读取库存/工单）
  if (meta.csvName) {
    const src = resourceFilePath(meta.csvName);
    const dst = path.join(dir, meta.csvName);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
    }
  }
  return { ...meta, storedName: meta.storedName, originalName: resource.originalName };
}