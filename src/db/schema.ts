import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  doublePrecision,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// users（新增）—— 登录与审计，所有人同权（操作员）
// ============================================================================

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  /** active | disabled */
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;

// ============================================================================
// user_sessions（新增）—— 会话（HttpOnly cookie 对应 session）
// ============================================================================

export const userSessions = pgTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [
    index("user_sessions_user_id_idx").on(t.userId),
    index("user_sessions_token_hash_idx").on(t.tokenHash),
  ],
);

export type UserSession = typeof userSessions.$inferSelect;

// ============================================================================
// BOM 工作流任务表（已存在，扩展字段）
// 存储任务元数据、解析结果、配置与执行摘要（文件本身存于磁盘临时目录）
// ============================================================================

export const bomJobs = pgTable("bom_jobs", {
  id: text("id").primaryKey(),
  name: text("name"),
  status: text("status").notNull().default("parsed"),
  files: jsonb("files").$type<unknown>(),
  config: jsonb("config").$type<unknown>(),
  summary: jsonb("summary").$type<unknown>(),
  /** BOM 匹配处理后的结果表格（TableData，含插入的分析列与颜色标记） */
  result: jsonb("result").$type<unknown>(),
  outputFileName: text("output_file_name"),
  error: text("error"),
  /** occupied_bom | target_bom | inventory_update */
  jobType: text("job_type"),
  uploadedBy: text("uploaded_by"),
  fileHash: text("file_hash"),
  /** 业务键：同产品/版本，用于重复与替换判定 */
  bizKey: text("biz_key"),
  /** 该 BOM 配置的套数 */
  sets: integer("sets"),
  /** active | inactive | duplicate | replaced */
  deductionStatus: text("deduction_status").default("active"),
  duplicateOfJobId: text("duplicate_of_job_id"),
  replacedByJobId: text("replaced_by_job_id"),
  reservedAt: timestamp("reserved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BomJob = typeof bomJobs.$inferSelect;

// ============================================================================
// 持久化数据资源表（库存表 / 工单调拨齐套报表）—— 已存在，扩展字段
// ============================================================================

export const bomResources = pgTable(
  "bom_resources",
  {
    /** 资源标识：inventory | work_order（库存资源支持多版本，id 唯一） */
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    /** 持久目录中的原始文件名 */
    storedName: text("stored_name").notNull(),
    originalName: text("original_name"),
    /** 解析后的文件元数据（ParsedFile） */
    meta: jsonb("meta").$type<unknown>(),
    uploadedBy: text("uploaded_by"),
    /** inventory | work_order | other */
    resourceType: text("resource_type"),
    fileHash: text("file_hash"),
    /** 仅 inventory 资源使用：当前生效 */
    isCurrent: boolean("is_current"),
    effectiveDate: date("effective_date"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bom_resources_current_inventory_idx")
      .on(t.isCurrent)
      .where(sql`is_current = true AND resource_type = 'inventory'`),
  ],
);

export type BomResource = typeof bomResources.$inferSelect;

// ============================================================================
// bom_demands（新增，关键）—— occupied BOM 标准化需求明细，用于汇总扣减
// ============================================================================

export const bomDemands = pgTable(
  "bom_demands",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    materialCode: text("material_code").notNull(),
    materialName: text("material_name"),
    spec: text("spec"),
    requiredQty: doublePrecision("required_qty").notNull(),
    sourceSheet: text("source_sheet"),
    sourceRowNo: integer("source_row_no"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bom_demands_material_code_idx").on(t.materialCode),
    index("bom_demands_job_id_idx").on(t.jobId),
    index("bom_demands_material_job_idx").on(t.materialCode, t.jobId),
  ],
);

export type BomDemand = typeof bomDemands.$inferSelect;

// ============================================================================
// inventory_snapshots（新增，关键）—— current 库存标准化明细，用于计算
// ============================================================================

export const inventorySnapshots = pgTable(
  "inventory_snapshots",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id").notNull(),
    snapshotDate: date("snapshot_date").notNull(),
    materialCode: text("material_code").notNull(),
    materialName: text("material_name"),
    spec: text("spec"),
    onHandQty: doublePrecision("on_hand_qty").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_snapshots_material_code_idx").on(t.materialCode),
    index("inventory_snapshots_resource_id_idx").on(t.resourceId),
  ],
);

export type InventorySnapshot = typeof inventorySnapshots.$inferSelect;

// ============================================================================
// audit_logs（新增，推荐）—— 审计追溯
// ============================================================================

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  /** login/upload/replace/recalculate/toggle_active/... */
  action: text("action").notNull(),
  /** job/resource */
  targetType: text("target_type"),
  targetId: text("target_id"),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
