// ============================================================================
// 审计日志 —— 所有上传、替换、重新计算、启停等操作写 audit_logs
// ============================================================================

import crypto from "node:crypto";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";

export type AuditAction =
  | "login"
  | "logout"
  | "register"
  | "change_password"
  | "upload_inventory"
  | "upload_work_order"
  | "upload_occupied_bom"
  | "upload_target_bom"
  | "toggle_active"
  | "replace"
  | "recalculate"
  | "set_current_inventory"
  | "delete_job";

export interface AuditInput {
  userId: string | null;
  action: AuditAction | string;
  targetType?: "job" | "resource" | "session" | null;
  targetId?: string | null;
  detail?: unknown;
}

/** 写一条审计日志（失败不影响主流程） */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: `log_${crypto.randomBytes(8).toString("hex")}`,
      userId: input.userId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      detail: (input.detail ?? null) as never,
    });
  } catch {
    // 审计失败不应阻断业务
  }
}
