import { NextRequest, NextResponse } from "next/server";
import { loadJob, updateJob, getResource, linkResourceToJob } from "@/lib/bom/storage";
import { db } from "@/db";
import { bomJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { executeWorkflow, SIX_HEADER_NAMES } from "@/lib/bom/orchestrator";
import { findHeaderColumn } from "@/lib/bom/parse";
import {
  USAGE_ALIASES,
  BOM_CODE_ALIASES,
  YIBO_CODE_ALIASES,
  YIBO_STOCK_ALIASES,
  YIBO_PROBLEM_ALIASES,
  PART_STATUS_ALIASES,
  QUANTITY_ALIASES,
} from "@/lib/bom/aliases";
import type { WorkflowConfig, ColumnMapping } from "@/lib/bom/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProcessBody {
  jobId: string;
  targetStoredName: string;
  targetSets: number;
  targetMapping?: Partial<ColumnMapping>;
  inventoryStoredName?: string;
  inventoryMapping?: { codeColumn?: string; qtyColumn?: string };
  occupied?: { storedName: string; sets: number }[];
  workOrderStoredName?: string;
  runPhase2?: boolean;
  runPhase3?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ProcessBody;
    const { jobId } = body;
    if (!jobId) {
      return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });
    }

    const state = await loadJob(jobId);
    if (!state) {
      return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    }

    const targetFile = state.files.find(
      (f) => f.storedName === body.targetStoredName,
    );
    if (!targetFile) {
      return NextResponse.json({ error: "未找到目标 BOM 文件" }, { status: 400 });
    }

    // 自动检测目标 BOM 列映射（用户可覆盖）
    const headerMap = targetFile.headerMap;
    const auto: ColumnMapping = {
      usageColumn:
        body.targetMapping?.usageColumn ||
        findHeaderColumn(headerMap, USAGE_ALIASES) ||
        undefined,
      bomCodeColumn:
        body.targetMapping?.bomCodeColumn ||
        findHeaderColumn(headerMap, BOM_CODE_ALIASES) ||
        undefined,
      yiboCodeColumn:
        body.targetMapping?.yiboCodeColumn ||
        findHeaderColumn(headerMap, YIBO_CODE_ALIASES) ||
        undefined,
      yiboStockColumn:
        body.targetMapping?.yiboStockColumn ||
        findHeaderColumn(headerMap, YIBO_STOCK_ALIASES) ||
        undefined,
      yiboProblemColumn:
        body.targetMapping?.yiboProblemColumn ||
        findHeaderColumn(headerMap, YIBO_PROBLEM_ALIASES) ||
        undefined,
      partStatusColumn:
        body.targetMapping?.partStatusColumn ||
        findHeaderColumn(headerMap, PART_STATUS_ALIASES) ||
        undefined,
      quantityColumn:
        body.targetMapping?.quantityColumn ||
        findHeaderColumn(headerMap, QUANTITY_ALIASES) ||
        undefined,
    };

    const occupiedBoms = (body.occupied ?? []).map((o) => {
      const f = state.files.find((x) => x.storedName === o.storedName);
      return {
        storedName: o.storedName,
        originalName: f?.originalName ?? o.storedName,
        role: "occupied" as const,
        sets: o.sets && o.sets > 0 ? o.sets : 1,
      };
    });
    // 库存表 / 工单表优先取自「持久资源」（每日更新）；若任务内也上传了同名文件则覆盖。
    // 将持久资源链接进任务目录，并入 state.files 供编排器读取。
    const mergedFiles = [...state.files];
    const invResource = await getResource("inventory");
    let inventoryRef: { storedName: string; originalName: string } | undefined;
    if (invResource && invResource.meta?.csvName) {
      const linked = linkResourceToJob(jobId, {
        storedName: invResource.storedName,
        originalName: invResource.originalName,
        meta: invResource.meta,
      });
      mergedFiles.push(linked);
      inventoryRef = { storedName: linked.storedName, originalName: linked.originalName };
    }
    const woResource = await getResource("work_order");
    let workOrderRef: { storedName: string; originalName: string } | undefined;
    if (woResource && woResource.meta?.csvName) {
      const linked = linkResourceToJob(jobId, {
        storedName: woResource.storedName,
        originalName: woResource.originalName,
        meta: woResource.meta,
      });
      mergedFiles.push(linked);
      workOrderRef = { storedName: linked.storedName, originalName: linked.originalName };
    }
    const mergedState: typeof state = { ...state, files: mergedFiles };
    const config: WorkflowConfig = {
      targetBom: {
        storedName: body.targetStoredName,
        originalName: targetFile.originalName,
        role: "target",
        sets: body.targetSets && body.targetSets > 0 ? body.targetSets : 1,
      },
      inventory: inventoryRef,
      inventoryMapping: body.inventoryMapping,
      occupiedBoms,
      workOrder: workOrderRef,
      targetMapping: auto,
      runPhase2: body.runPhase2 !== false,
      runPhase3: !!body.runPhase3,
    };
    const { summary, outputPath, table } = await executeWorkflow({
      jobId,
      state: mergedState,
      config,
    });

    await updateJob(jobId, targetFile.originalName, {
      status: "done",
      config,
      summary,
      outputFileName: summary.outputFileName,
    });
    // 持久化匹配后的结果表格（含插入的分析列与颜色标记），供历史记录查看
    await db
      .update(bomJobs)
      .set({ result: table as never, updatedAt: new Date() })
      .where(eq(bomJobs.id, jobId));

    // outputPath 仅供服务端使用，客户端通过编辑后表格导出
    void outputPath;

    return NextResponse.json({
      jobId,
      summary,
      table,
      addedColumns: SIX_HEADER_NAMES,
      outputFileName: summary.outputFileName,
    });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    return NextResponse.json(
      { error: `执行失败：${msg}` },
      { status: 500 },
    );
  }
}
