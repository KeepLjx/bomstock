// ============================================================================
// 持久化存储辅助（新系统）
// - 文件哈希 (sha256) 与 biz_key 推导
// - 库存快照 / 需求明细 写入
// - 重复判定 (file_hash / biz_key) 与替换、启停生命周期
// ============================================================================

import crypto from "node:crypto";
import { db } from "@/db";
import {
  bomJobs,
  bomDemands,
  inventorySnapshots,
  bomResources,
} from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { extractProductName } from "@/lib/bom/parse";
import type { InventoryRow, DemandRow } from "@/lib/inventory";

/** 计算文件内容 sha256 */
export function fileHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * 推导业务键 biz_key（用于「同产品新版本」替换判定）。
 * 策略：优先从文件名提取产品名；兜底返回 null（仅做 file_hash 控制）。
 */
export function deriveBizKey(originalName: string): string | null {
  const product = extractProductName(originalName);
  if (!product || product.length < 2) return null;
  return product.toUpperCase();
}

// ---------------------------------------------------------------------------
// 快照 / 需求 持久化
// ---------------------------------------------------------------------------

export async function persistInventorySnapshots(
  resourceId: string,
  rows: InventoryRow[],
  snapshotDate: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => ({
    id: `isnap_${crypto.randomBytes(8).toString("hex")}`,
    resourceId,
    snapshotDate,
    materialCode: r.materialCode,
    materialName: r.materialName || null,
    spec: r.spec || null,
    onHandQty: r.onHandQty,
  }));
  // 分批插入，避免单条 SQL 过大
  const BATCH = 500;
  for (let i = 0; i < values.length; i += BATCH) {
    await db.insert(inventorySnapshots).values(values.slice(i, i + BATCH));
  }
  return values.length;
}

/** 删除某资源的旧快照 */
export async function clearInventorySnapshots(resourceId: string): Promise<void> {
  await db
    .delete(inventorySnapshots)
    .where(eq(inventorySnapshots.resourceId, resourceId));
}

export async function persistJobDemands(
  jobId: string,
  rows: DemandRow[],
  sourceSheet: string | null,
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => ({
    id: `dem_${crypto.randomBytes(8).toString("hex")}`,
    jobId,
    materialCode: r.materialCode,
    materialName: r.materialName || null,
    spec: r.spec || null,
    requiredQty: r.requiredQty,
    sourceSheet,
    sourceRowNo: r.sourceRowNo ?? null,
  }));
  const BATCH = 500;
  for (let i = 0; i < values.length; i += BATCH) {
    await db.insert(bomDemands).values(values.slice(i, i + BATCH));
  }
  return values.length;
}

export async function clearJobDemands(jobId: string): Promise<void> {
  await db.delete(bomDemands).where(eq(bomDemands.jobId, jobId));
}

/**
 * 级联删除某 BOM 作业：先删其需求明细，再删作业记录本身。
 * （磁盘文件由调用方通过 storage.removeJobDir 一并清理）
 */
export async function deleteJobCascade(jobId: string): Promise<void> {
  await db.delete(bomDemands).where(eq(bomDemands.jobId, jobId));
  await db.delete(bomJobs).where(eq(bomJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// 重复判定与生命周期
// ---------------------------------------------------------------------------

export type DeductionStatus = "active" | "inactive" | "duplicate" | "replaced";

/** 按 file_hash 查找已存在的 occupied BOM 作业 */
export async function findJobByHash(
  hash: string,
): Promise<typeof bomJobs.$inferSelect | null> {
  const rows = await db
    .select()
    .from(bomJobs)
    .where(and(eq(bomJobs.fileHash, hash), eq(bomJobs.jobType, "occupied_bom")))
    .limit(1);
  return rows[0] ?? null;
}

/** 按 biz_key 查找当前 active 的 occupied BOM（用于替换） */
export async function findActiveJobByBizKey(
  bizKey: string,
  excludeJobId?: string,
): Promise<typeof bomJobs.$inferSelect | null> {
  const rows = await db
    .select()
    .from(bomJobs)
    .where(
      and(
        eq(bomJobs.bizKey, bizKey),
        eq(bomJobs.jobType, "occupied_bom"),
        eq(bomJobs.deductionStatus, "active"),
        ...(excludeJobId ? [ne(bomJobs.id, excludeJobId)] : []),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function setJobDeductionStatus(
  jobId: string,
  status: DeductionStatus,
  extra?: Partial<{
    duplicateOfJobId: string | null;
    replacedByJobId: string | null;
    reservedAt: Date | null;
  }>,
): Promise<void> {
  await db
    .update(bomJobs)
    .set({
      deductionStatus: status,
      updatedAt: new Date(),
      duplicateOfJobId: extra?.duplicateOfJobId ?? null,
      replacedByJobId: extra?.replacedByJobId ?? null,
      reservedAt: extra?.reservedAt ?? null,
    })
    .where(eq(bomJobs.id, jobId));
}

/** 将某 occupied BOM 标记为 replaced（停止扣减），并指向新版本 */
export async function markReplaced(oldJobId: string, newJobId: string): Promise<void> {
  await db
    .update(bomJobs)
    .set({
      deductionStatus: "replaced",
      replacedByJobId: newJobId,
      updatedAt: new Date(),
    })
    .where(eq(bomJobs.id, oldJobId));
}

// ---------------------------------------------------------------------------
// 库存 current 切换
// ---------------------------------------------------------------------------

/** 设某 inventory 资源为 current，其余 inventory 置为非 current */
export async function setCurrentInventory(resourceId: string): Promise<void> {
  const all = await db
    .select()
    .from(bomResources)
    .where(eq(bomResources.resourceType, "inventory"));
  for (const r of all) {
    if (r.id === resourceId) continue;
    if (r.isCurrent) {
      await db
        .update(bomResources)
        .set({ isCurrent: false, updatedAt: new Date() })
        .where(eq(bomResources.id, r.id));
    }
  }
  await db
    .update(bomResources)
    .set({ isCurrent: true, updatedAt: new Date() })
    .where(eq(bomResources.id, resourceId));
}
