// ============================================================================
// 实时可用库存计算服务
//
// 口径（全局统一）：
//   实时可用库存 = current inventory snapshot
//                − SUM(active occupied BOM 需求量, 且未被工单确认跳过)
//
// 仅 occupied BOM 参与扣减；target BOM 仅用于标色，不扣减库存。
// 阶段三 runPhase3 控制是否应用「工单调拨齐套报表」跳过逻辑。
// ============================================================================

import { db } from "@/db";
import {
  inventorySnapshots,
  bomDemands,
  bomJobs,
  bomResources,
  users,
} from "@/db/schema";
import { eq, and, isNotNull, inArray } from "drizzle-orm";
import {
  readCSV,
  tableStr,
  type CleanedTable,
} from "@/lib/bom/csv";
import { resourceFilePath } from "@/lib/bom/storage";
import {
  findHeaderColumn,
  parseLooseNumber,
  extractProductName,
} from "@/lib/bom/parse";
import { normalizeBomCode, standardizeCode } from "@/lib/bom/engine";
import {
  persistInventorySnapshots,
  setCurrentInventory,
  persistJobDemands,
} from "@/lib/bom/store";
import { filePathOf } from "@/lib/bom/storage";
import {
  INVENTORY_CODE_ALIASES,
  INVENTORY_QTY_ALIASES,
  BOM_CODE_ALIASES,
  DEMAND_ALIASES,
  USAGE_ALIASES,
  MATERIAL_NAME_ALIASES,
  SPEC_ALIASES,
  WORK_ORDER_PRODUCT_ALIASES,
  WORK_ORDER_QTY_ALIASES,
} from "@/lib/bom/aliases";

// ---------------------------------------------------------------------------
// 标准化明细抽取
// ---------------------------------------------------------------------------

export interface InventoryRow {
  materialCode: string;
  materialName: string;
  spec: string;
  onHandQty: number;
}

export interface DemandRow {
  materialCode: string;
  materialName: string;
  spec: string;
  requiredQty: number;
  sourceRowNo: number;
}

/** 从库存 CSV 抽取标准化明细（按物料编码聚合 on_hand_qty） */
export function extractInventoryRows(csvPath: string): InventoryRow[] {
  const table = readCSV(csvPath);
  const codeName = findHeaderColumn(table.headerMap, INVENTORY_CODE_ALIASES);
  const qtyName = findHeaderColumn(table.headerMap, INVENTORY_QTY_ALIASES);
  if (!codeName || !qtyName) return [];
  const nameName = findHeaderColumn(table.headerMap, MATERIAL_NAME_ALIASES);
  const specName = findHeaderColumn(table.headerMap, SPEC_ALIASES);

  const map = new Map<
    string,
    { code: string; name: string; spec: string; qty: number }
  >();
  table.rows.forEach((row, i) => {
    const code = standardizeCode(tableStr(table, row, codeName));
    if (!code) return;
    const qty = parseLooseNumber(tableStr(table, row, qtyName)) ?? 0;
    const name = nameName ? tableStr(table, row, nameName) : "";
    const spec = specName ? tableStr(table, row, specName) : "";
    const prev = map.get(code);
    if (prev) {
      prev.qty += qty;
      if (!prev.name && name) prev.name = name;
      if (!prev.spec && spec) prev.spec = spec;
    } else {
      map.set(code, { code, name, spec, qty });
    }
    void i;
  });
  return Array.from(map.values()).map((v) => ({
    materialCode: v.code,
    materialName: v.name,
    spec: v.spec,
    onHandQty: v.qty,
  }));
}

/**
 * 从 occupied BOM CSV 抽取标准化需求明细。
 * 优先读取「需求数量」列（已含套数）；否则用 单机用量 × sets。
 */
export function extractDemandRows(
  csvPath: string,
  sets: number,
): DemandRow[] {
  const table = readCSV(csvPath);
  const codeName = findHeaderColumn(table.headerMap, BOM_CODE_ALIASES);
  if (!codeName) return [];
  const demandName = findHeaderColumn(table.headerMap, DEMAND_ALIASES);
  const usageName = findHeaderColumn(table.headerMap, USAGE_ALIASES);
  if (!demandName && !usageName) return [];
  const nameName = findHeaderColumn(table.headerMap, MATERIAL_NAME_ALIASES);
  const specName = findHeaderColumn(table.headerMap, SPEC_ALIASES);
  const s = sets && sets > 0 ? sets : 1;

  const map = new Map<
    string,
    { code: string; name: string; spec: string; qty: number; row: number }
  >();
  table.rows.forEach((row, i) => {
    const codeStr = tableStr(table, row, codeName);
    if (!codeStr) return;
    const code = normalizeBomCode(codeStr);
    if (!code) return;
    let qty: number;
    if (demandName) {
      qty = parseLooseNumber(tableStr(table, row, demandName)) ?? 0;
    } else {
      const usage = parseLooseNumber(tableStr(table, row, usageName!)) ?? 0;
      qty = usage * s;
    }
    if (qty <= 0) return;
    const name = nameName ? tableStr(table, row, nameName) : "";
    const spec = specName ? tableStr(table, row, specName) : "";
    const prev = map.get(code);
    if (prev) {
      prev.qty += qty;
      if (!prev.name && name) prev.name = name;
      if (!prev.spec && spec) prev.spec = spec;
    } else {
      map.set(code, { code, name, spec, qty, row: i + 2 });
    }
  });
  return Array.from(map.values()).map((v) => ({
    materialCode: v.code,
    materialName: v.name,
    spec: v.spec,
    requiredQty: v.qty,
    sourceRowNo: v.row,
  }));
}

// ---------------------------------------------------------------------------
// 当前生效库存资源
// ---------------------------------------------------------------------------

export interface CurrentInventory {
  resourceId: string | null;
  originalName: string;
  storedName: string;
  csvName: string | null;
  updatedAt: string | null;
  effectiveDate: string | null;
  rowCount: number;
}

export async function getCurrentInventoryResource() {
  // 优先：resource_type='inventory' 且 is_current=true
  const rows = await db
    .select()
    .from(bomResources)
    .where(
      and(
        eq(bomResources.resourceType, "inventory"),
        eq(bomResources.isCurrent, true),
      ),
    )
    .limit(1);
  let r = rows[0];
  // 兜底：兼容旧数据（id='inventory' 的单行资源）
  if (!r) {
    const legacy = await db
      .select()
      .from(bomResources)
      .where(eq(bomResources.id, "inventory"))
      .limit(1);
    r = legacy[0];
  }
  if (!r) return null;
  return r;
}

export async function getCurrentInventory(): Promise<CurrentInventory | null> {
  const r = await getCurrentInventoryResource();
  if (!r) return null;
  const meta = (r.meta ?? {}) as { csvName?: string; rowCount?: number };
  return {
    resourceId: r.id,
    originalName: r.originalName ?? "",
    storedName: r.storedName,
    csvName: meta.csvName ?? null,
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    effectiveDate: r.effectiveDate ?? null,
    rowCount: meta.rowCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// 工单调拨齐套报表 —— 阶段三跳过逻辑
// ---------------------------------------------------------------------------

/** 读取持久 work_order 资源，返回 (productName, sets) => 是否应跳过扣减 */
function buildWorkOrderCheckerFromTable(
  table: CleanedTable,
): ((productName: string, sets: number) => boolean) | null {
  const productNameCol = findHeaderColumn(table.headerMap, WORK_ORDER_PRODUCT_ALIASES);
  const qtyCol = findHeaderColumn(table.headerMap, WORK_ORDER_QTY_ALIASES);
  if (!productNameCol || !qtyCol) return null;
  const entries: { name: string; qty: number }[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    const name = tableStr(table, row, productNameCol).toUpperCase();
    if (!name) continue;
    const qty = parseLooseNumber(tableStr(table, row, qtyCol));
    const key = `${name}|${qty ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (qty !== null) entries.push({ name, qty });
  }
  return (productName: string, sets: number): boolean => {
    if (!productName) return false;
    const pn = productName.toUpperCase();
    for (const e of entries) {
      if (e.name.includes(pn) && e.qty === sets) return true;
    }
    return false;
  };
}

async function getWorkOrderChecker():
  Promise<((productName: string, sets: number) => boolean) | null> {
  const rows = await db
    .select()
    .from(bomResources)
    .where(eq(bomResources.id, "work_order"))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  const meta = (r.meta ?? {}) as { csvName?: string };
  if (!meta.csvName) return null;
  try {
    const table = readCSV(resourceFilePath(meta.csvName));
    return buildWorkOrderCheckerFromTable(table);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 实时可用库存计算
// ---------------------------------------------------------------------------

export interface AvailableMaterial {
  materialCode: string;
  materialName: string;
  spec: string;
  baseQty: number;
  reservedQty: number;
  availableQty: number;
  shortage: number;
}

export interface ActiveOccupiedJob {
  id: string;
  name: string;
  sets: number;
  bizKey: string | null;
  skipped: boolean;
  demandRows: number;
}

export interface RealtimeResult {
  current: CurrentInventory | null;
  baseQtyTotal: number;
  reservedQtyTotal: number;
  materialCount: number;
  reservedJobCount: number;
  skippedJobCount: number;
  shortageCount: number;
  runPhase3: boolean;
  jobs: ActiveOccupiedJob[];
  materials: AvailableMaterial[];
}

export interface CalcOptions {
  /** 模拟计算：仅使用这些 job_id（默认全部 active） */
  selectedJobIds?: string[];
  /** 是否应用工单跳过逻辑 */
  runPhase3?: boolean;
}

/**
 * 计算实时可用库存。
 * base = current inventory snapshot；reserved = active occupied demands（扣减未跳过）。
 */
export async function calculateRealtime(
  opts: CalcOptions = {},
): Promise<RealtimeResult> {
  const runPhase3 = opts.runPhase3 !== false;
  const current = await getCurrentInventory();

  // 1) 基线库存（懒加载：若 current 资源无快照，则从 CSV 现场生成并持久化）
  const baseMap = new Map<
    string,
    { name: string; spec: string; qty: number }
  >();
  if (current?.resourceId) {
    let snaps = await db
      .select()
      .from(inventorySnapshots)
      .where(eq(inventorySnapshots.resourceId, current.resourceId));
    if (snaps.length === 0 && current.csvName) {
      // 兼容历史数据：旧资源上传未生成快照，现从 CSV 补建
      try {
        const rows = extractInventoryRows(resourceFilePath(current.csvName));
        const snapDate = current.effectiveDate ?? new Date().toISOString().slice(0, 10);
        await persistInventorySnapshots(current.resourceId, rows, snapDate);
        // 同时规范化资源字段（补 resource_type / is_current）
        await db
          .update(bomResources)
          .set({
            resourceType: "inventory",
            isCurrent: true,
            effectiveDate: snapDate,
            updatedAt: new Date(),
          })
          .where(eq(bomResources.id, current.resourceId));
        snaps = await db
          .select()
          .from(inventorySnapshots)
          .where(eq(inventorySnapshots.resourceId, current.resourceId));
      } catch {
        // 补建失败则按空库存继续
      }
    }
    for (const s of snaps) {
      const prev = baseMap.get(s.materialCode);
      if (prev) {
        prev.qty += s.onHandQty;
      } else {
        baseMap.set(s.materialCode, {
          name: s.materialName ?? "",
          spec: s.spec ?? "",
          qty: s.onHandQty,
        });
      }
    }
  }

  // 2) 选中参与扣减的 occupied BOM
  let activeJobs = await db
    .select()
    .from(bomJobs)
    .where(eq(bomJobs.jobType, "occupied_bom"));

  // 仅活跃（默认）；若指定 selectedJobIds，则按集合筛选（模拟）
  if (opts.selectedJobIds && opts.selectedJobIds.length >= 0) {
    const sel = new Set(opts.selectedJobIds);
    if (sel.size > 0) {
      activeJobs = activeJobs.filter(
        (j) => sel.has(j.id) && (j.deductionStatus ?? "active") === "active",
      );
    } else {
      // 显式空集合 → 无扣减
      activeJobs = [];
    }
  } else {
    activeJobs = activeJobs.filter((j) => (j.deductionStatus ?? "active") === "active");
  }

  // 3) 阶段三：工单跳过
  const checker = runPhase3 ? await getWorkOrderChecker() : null;
  const jobs: ActiveOccupiedJob[] = [];
  const skippedIds = new Set<string>();
  for (const j of activeJobs) {
    const sets = j.sets ?? 1;
    const productName = extractProductName(j.name ?? "");
    let skipped = false;
    if (checker) {
      skipped = checker(productName, sets);
    }
    if (skipped) skippedIds.add(j.id);
    jobs.push({
      id: j.id,
      name: j.name ?? "",
      sets,
      bizKey: j.bizKey,
      skipped,
      demandRows: 0,
    });
  }

  // 4) 汇总 reserved（未跳过的 active job 的 demands）
  const validJobIds = activeJobs
    .filter((j) => !skippedIds.has(j.id))
    .map((j) => j.id);
  const validJobSet = new Set(validJobIds);
  const reservedMap = new Map<string, number>();
  const demandCountByJob = new Map<string, number>();
  if (validJobIds.length > 0) {
    let demands = await db
      .select()
      .from(bomDemands)
      .where(isNotNull(bomDemands.jobId));
    // 懒加载：对没有 demands 的有效 occupied job，从其 CSV 现场补建
    const haveDemands = new Set(demands.map((d) => d.jobId));
    const validJobsById = new Map(activeJobs.map((j) => [j.id, j]));
    for (const jid of validJobIds) {
      if (haveDemands.has(jid)) continue;
      const job = validJobsById.get(jid);
      if (!job) continue;
      const files = (job.files ?? []) as { csvName?: string }[];
      const csvName = files[0]?.csvName;
      if (!csvName) continue;
      try {
        const rows = extractDemandRows(filePathOf(jid, csvName), job.sets ?? 1);
        await persistJobDemands(jid, rows, null);
      } catch {
        // 补建失败跳过
      }
    }
    // 重新读取（含补建后的）
    demands = await db
      .select()
      .from(bomDemands)
      .where(isNotNull(bomDemands.jobId));
    for (const d of demands) {
      if (!validJobSet.has(d.jobId)) continue;
      reservedMap.set(
        d.materialCode,
        (reservedMap.get(d.materialCode) ?? 0) + d.requiredQty,
      );
      demandCountByJob.set(d.jobId, (demandCountByJob.get(d.jobId) ?? 0) + 1);
    }
  }
  for (const j of jobs) {
    j.demandRows = demandCountByJob.get(j.id) ?? 0;
  }

  // 5) 合并 base ∪ reserved -> 可用库存
  const codes = new Set<string>([...baseMap.keys(), ...reservedMap.keys()]);
  const materials: AvailableMaterial[] = [];
  let baseQtyTotal = 0;
  let reservedQtyTotal = 0;
  let shortageCount = 0;
  for (const code of codes) {
    const base = baseMap.get(code);
    const reserved = reservedMap.get(code) ?? 0;
    const baseQty = base?.qty ?? 0;
    const available = baseQty - reserved;
    const shortage = Math.max(0, reserved - baseQty);
    baseQtyTotal += baseQty;
    reservedQtyTotal += reserved;
    if (shortage > 0) shortageCount += 1;
    materials.push({
      materialCode: code,
      materialName: base?.name ?? "",
      spec: base?.spec ?? "",
      baseQty,
      reservedQty: reserved,
      availableQty: available,
      shortage,
    });
  }
  // 按可用库存升序（最紧张的在前）
  materials.sort((a, b) => a.availableQty - b.availableQty);

  return {
    current,
    baseQtyTotal,
    reservedQtyTotal,
    materialCount: materials.length,
    reservedJobCount: validJobIds.length,
    skippedJobCount: skippedIds.size,
    shortageCount,
    runPhase3,
    jobs,
    materials,
  };
}

// ---------------------------------------------------------------------------
// 单物料明细：该物料来自哪些 occupied BOM，以及各自需求量（联表查询，完整信息）
// ---------------------------------------------------------------------------

export interface MaterialDemandSource {
  jobId: string;
  jobName: string;
  bizKey: string | null;
  sets: number;
  requiredQty: number;
  sourceRowNo: number | null;
  sourceSheet: string | null;
  /** 该作业对本物料的需求明细行数 */
  demandCount: number;
  skipped: boolean;
  deductionStatus: string | null;
  /** 是否实际计入全局预扣减（active 且未被工单跳过） */
  effective: boolean;
  /** 上传者用户 id */
  uploadedBy: string | null;
  /** 上传者显示名（联表 users 解析） */
  uploaderName: string | null;
  jobCreatedAt: string | null;
  reservedAt: string | null;
  /** 作业原始文件名（files[0].originalName） */
  fileOriginalName: string | null;
  duplicateOfJobId: string | null;
  replacedByJobId: string | null;
}

export interface MaterialInventoryInfo {
  resourceId: string | null;
  resourceName: string;
  effectiveDate: string | null;
  updatedAt: string | null;
  rowCount: number;
  /** 该物料在当前库存表中的快照行数（同一物料可能多行） */
  snapshotCount: number;
}

export interface MaterialDetail {
  materialCode: string;
  materialName: string;
  spec: string;
  baseQty: number;
  /** 实际计入扣减的需求总量（active 且未跳过） */
  totalDemand: number;
  /** 全部 occupied BOM 对该物料的需求合计（含停用/跳过/历史，用于参考） */
  grossDemand: number;
  availableQty: number;
  shortage: number;
  inventory: MaterialInventoryInfo;
  sourceCount: number;
  sources: MaterialDemandSource[];
}

/**
 * 批量解析上传者 id -> 显示名（联表 users）
 */
async function resolveUserNames(
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (uniq.length === 0) return out;
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(inArray(users.id, uniq));
  for (const r of rows) {
    out.set(r.id, r.displayName || r.username);
  }
  return out;
}

/**
 * 查询某物料编码的全部相关数据（联表查询，完整信息）：
 * - 基线库存（current 库存快照 + 资源名/生效日/更新时间）
 * - 来自哪些 occupied BOM：作业名 / biz_key / 套数 / 需求量 / 行号 / 来源 sheet /
 *   需求行数 / 上传者 / 上传时间 / 预留时间 / 原始文件名 / 重复·替换关系
 * - 是否被工单跳过、是否计入扣减
 */
export async function getMaterialDetail(
  materialCode: string,
  runPhase3 = true,
): Promise<MaterialDetail> {
  const current = await getCurrentInventory();
  let baseQty = 0;
  let materialName = "";
  let spec = "";
  let snapshotCount = 0;

  if (current?.resourceId) {
    const snaps = await db
      .select()
      .from(inventorySnapshots)
      .where(
        and(
          eq(inventorySnapshots.resourceId, current.resourceId),
          eq(inventorySnapshots.materialCode, materialCode),
        ),
      );
    snapshotCount = snaps.length;
    for (const s of snaps) {
      baseQty += s.onHandQty;
      if (!materialName && s.materialName) materialName = s.materialName ?? "";
      if (!spec && s.spec) spec = s.spec ?? "";
    }
  }

  const checker = runPhase3 ? await getWorkOrderChecker() : null;

  // 全部 occupied BOM（active / inactive / replaced / duplicate 均纳入，完整展示）
  const jobs = await db.select().from(bomJobs).where(eq(bomJobs.jobType, "occupied_bom"));

  // 联表：需求明细 bom_demands JOIN bom_jobs（按物料编码过滤）
  // 先对无 demands 的作业做懒加载补建，保证结果完整
  const validJobIds = jobs.map((j) => j.id);
  if (validJobIds.length > 0) {
    const haveDemands = new Set(
      (await db
        .select({ jobId: bomDemands.jobId })
        .from(bomDemands)
        .where(inArray(bomDemands.jobId, validJobIds)))
        .map((r) => r.jobId),
    );
    for (const j of jobs) {
      if (haveDemands.has(j.id)) continue;
      const files = (j.files ?? []) as { csvName?: string }[];
      const csvName = files[0]?.csvName;
      if (!csvName) continue;
      try {
        const rows = extractDemandRows(filePathOf(j.id, csvName), j.sets ?? 1);
        await persistJobDemands(j.id, rows, null);
      } catch {
        // 补建失败跳过
      }
    }
  }

  // 一次性联表查询：bom_demands <-> bom_jobs（仅本物料）
  const joined = await db
    .select({
      demand: bomDemands,
      job: bomJobs,
    })
    .from(bomDemands)
    .innerJoin(bomJobs, eq(bomDemands.jobId, bomJobs.id))
    .where(eq(bomDemands.materialCode, materialCode));

  // 按作业聚合
  const byJob = new Map<string, typeof joined>();
  for (const row of joined) {
    const arr = byJob.get(row.job.id) ?? [];
    arr.push(row);
    byJob.set(row.job.id, arr);
  }

  // 解析上传者名（联表 users）
  const uploaderIds = jobs.map((j) => j.uploadedBy).filter(Boolean) as string[];
  const userNames = await resolveUserNames(uploaderIds);

  const sources: MaterialDemandSource[] = [];
  let totalDemand = 0;
  let grossDemand = 0;

  for (const j of jobs) {
    const group = byJob.get(j.id);
    if (!group || group.length === 0) continue;
    const status = j.deductionStatus ?? "active";
    const sets = j.sets ?? 1;
    const requiredQty = group.reduce((s, r) => s + r.demand.requiredQty, 0);
    const first = group[0];
    if (!materialName && first.demand.materialName) materialName = first.demand.materialName ?? "";
    if (!spec && first.demand.spec) spec = first.demand.spec ?? "";

    let skipped = false;
    if (checker) skipped = checker(extractProductName(j.name ?? ""), sets);
    const effective = status === "active" && !skipped;

    const files = (j.files ?? []) as { originalName?: string }[];

    sources.push({
      jobId: j.id,
      jobName: j.name ?? "",
      bizKey: j.bizKey,
      sets,
      requiredQty,
      sourceRowNo: first.demand.sourceRowNo ?? null,
      sourceSheet: first.demand.sourceSheet ?? null,
      demandCount: group.length,
      skipped,
      deductionStatus: status,
      effective,
      uploadedBy: j.uploadedBy ?? null,
      uploaderName: j.uploadedBy ? userNames.get(j.uploadedBy) ?? null : null,
      jobCreatedAt: j.createdAt ? j.createdAt.toISOString() : null,
      reservedAt: j.reservedAt ? j.reservedAt.toISOString() : null,
      fileOriginalName: files[0]?.originalName ?? null,
      duplicateOfJobId: j.duplicateOfJobId ?? null,
      replacedByJobId: j.replacedByJobId ?? null,
    });

    grossDemand += requiredQty;
    if (effective) totalDemand += requiredQty;
  }

  // 来源：计入扣减的优先，其次需求量降序，最后按上传时间降序
  sources.sort((a, b) => {
    if (a.effective !== b.effective) return a.effective ? -1 : 1;
    if (b.requiredQty !== a.requiredQty) return b.requiredQty - a.requiredQty;
    return (b.jobCreatedAt ?? "").localeCompare(a.jobCreatedAt ?? "");
  });

  const availableQty = baseQty - totalDemand;
  const shortage = Math.max(0, totalDemand - baseQty);

  return {
    materialCode,
    materialName,
    spec,
    baseQty,
    totalDemand,
    grossDemand,
    availableQty,
    shortage,
    inventory: {
      resourceId: current?.resourceId ?? null,
      resourceName: current?.originalName ?? "",
      effectiveDate: current?.effectiveDate ?? null,
      updatedAt: current?.updatedAt ?? null,
      rowCount: current?.rowCount ?? 0,
      snapshotCount,
    },
    sourceCount: sources.length,
    sources,
  };
}
