"use client";
import { useEffect, useMemo, useState } from "react";
import { type ParsedFileDTO, type ResourcesState} from "./types";
import SheetPreviewModal from "./SheetPreviewModal";
import { apiFetch } from "@/lib/api-client";

export interface ProcessPayload {
  targetStoredName: string;
  targetSets: number;
  targetMapping: Record<string, string | undefined>;
  inventoryStoredName?: string;
  inventoryMapping?: { codeColumn?: string; qtyColumn?: string };
  occupied: { storedName: string; sets: number }[];
  workOrderStoredName?: string;
  runPhase2: boolean;
  runPhase3: boolean;
  /** 回退恢复用：完整角色映射 */
  __roles?: Record<string, string>;
  /** 回退恢复用：完整套数映射（storedName -> 套数） */
  setsMap?: Record<string, number>;
}

interface Props {
  jobId: string;
  files: ParsedFileDTO[];
  /** 持久数据资源（库存表 / 工单表） */
  resources?: ResourcesState | null;
  /** 回退到本步骤时恢复的上次配置（需求 4） */
  initialConfig?: ProcessPayload;
  onFileUpdated: (file: ParsedFileDTO) => void;
  onExecute: (payload: ProcessPayload) => Promise<void>;
  onBack: () => void;
  processing: boolean;
}

const MAPPING_FIELDS: {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
}[] = [
  { key: "quantityColumn", label: "Quantity 列（插入6列锚点）", required: true, hint: "新增6列将插入到此列之后" },
  { key: "usageColumn", label: "单机用量 / Quantity", required: true, hint: "用于计算需求数量" },
  { key: "bomCodeColumn", label: "存货编码 / 物料编码", required: true, hint: "用于与库存匹配" },
  { key: "yiboCodeColumn", label: "一博物料编码" },
  { key: "yiboStockColumn", label: "一博物料库存" },
  { key: "yiboProblemColumn", label: "一博问题（插入JZD确认锚点）" },
  { key: "partStatusColumn", label: "零件状态" },
];

const INV_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "codeColumn", label: "物料编码", required: true },
  { key: "qtyColumn", label: "总数量", required: true },
];
/**
 * 各列字段的别名集合（用于按名称自动匹配列）。
 * 库存表字段一般为固定名称，优先据此默认选中。
 */
const FIELD_ALIASES: Record<string, string[]> = {
  // 目标 BOM 列
  quantityColumn: ["Quantity", "数量", "Qty", "BOM数量", "总用量"],
  usageColumn: ["单机用量", "用量", "每台用量", "单台用量", "Quantity", "Qty"],
  bomCodeColumn: ["存货编码", "物料编码", "存货编号", "料号", "编码", "Part"],
  yiboCodeColumn: ["一博物料编码", "一博编码", "一博料号", "YIBO"],
  yiboStockColumn: ["一博物料库存", "一博库存", "一博库存量", "库存"],
  yiboProblemColumn: ["一博问题", "问题", "一博备注"],
  partStatusColumn: ["零件状态", "物料状态", "状态"],
  // 库存表列（固定字段名）
  codeColumn: [
    "物料编码",
    "一博物料编码",
    "存货编码",
    "物料编号",
    "料号",
    "编码",
    "Code",
    "Part",
  ],
  qtyColumn: [
    "总数量",
    "现存数量",
    "库存数量",
    "可用数量",
    "数量",
    "总库存",
    "Qty",
    "Stock",
  ],
};
/** 按别名匹配列名：先精确（忽略大小写），再包含；长别名优先避免误匹配 */
function matchField(
  headerNames: string[],
  aliases: string[],
): string | undefined {
  const sorted = [...aliases].sort((a, b) => b.length - a.length);
  for (const a of sorted) {
    const al = a.toLowerCase();
    const exact = headerNames.find((n) => n.toLowerCase() === al);
    if (exact) return exact;
  }
  for (const a of sorted) {
    const al = a.toLowerCase();
    const inc = headerNames.find((n) => n.toLowerCase().includes(al));
    if (inc) return inc;
  }
  return undefined;
}

export default function ConfigPanel({
  jobId,
  files,
  resources,
  initialConfig,
  onFileUpdated,
  onExecute,
  onBack,
  processing,
}: Props) {
  const bomFiles = files.filter((f) => f.kind === "bom");
  const invFiles = files.filter((f) => f.kind === "inventory");
  const transferFiles = files.filter((f) => f.kind === "transfer");
  // 回退时若提供了上次配置，则据此恢复角色
  const prevRoles = initialConfig?.__roles ?? null;
  // 角色状态
  const [roles, setRoles] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    // 优先沿用已保存的角色
    const saved = new Map<string, string>(
      Object.entries(prevRoles ?? {}),
    );
    let targetAssigned = false;
    for (const f of bomFiles) {
      const s = saved.get(f.storedName);
      if (s === "target" && !targetAssigned) {
        m[f.storedName] = "target";
        targetAssigned = true;
      } else if (s === "occupied") {
        m[f.storedName] = "occupied";
      } else if (f.role === "target" && !targetAssigned) {
        m[f.storedName] = "target";
        targetAssigned = true;
      } else {
        m[f.storedName] = "occupied";
      }
    }
    if (!targetAssigned && bomFiles[0]) m[bomFiles[0].storedName] = "target";
    return m;
  });
  // 套数：已占用 BOM 自动读取表中的套数（detectedSets），目标 BOM 默认 1
  const [sets, setSets] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    const savedSets = new Map<string, number>(
      Object.entries(initialConfig?.setsMap ?? {}),
    );
    for (const f of bomFiles) {
      if (savedSets.has(f.storedName)) {
        m[f.storedName] = savedSets.get(f.storedName)!;
      } else {
        const auto = f.detectedSets && f.detectedSets > 0 ? f.detectedSets : 1;
        m[f.storedName] = auto;
      }
    }
    return m;
  });
  const [inventoryStored, setInventoryStored] = useState<string>(
    invFiles[0]?.storedName ?? "",
  );
  const [workOrderStored, setWorkOrderStored] = useState<string>(
    transferFiles[0]?.storedName ?? "",
  );

  const targetStored = useMemo(
    () => bomFiles.find((f) => roles[f.storedName] === "target")?.storedName,
    [bomFiles, roles],
  );
  const targetFile = files.find((f) => f.storedName === targetStored);
  // 库存表 / 工单表取自持久资源
  const inventoryFile = resources?.inventory.file;
  const workOrderFile = resources?.workOrder.file;

  const autoPick = (
    file: ParsedFileDTO | undefined,
    keys: string[],
  ): Record<string, string | undefined> => {
    const out: Record<string, string | undefined> = {};
    if (!file) return out;
    const names = file.headers.map((h) => h.name);
    for (const key of keys) {
      const def = [...MAPPING_FIELDS, ...INV_FIELDS].find((m) => m.key === key);
      const label = def?.label ?? key;
      // 标签关键词作为补充别名
      const labelKw = label
        .replace(/[（）()/]/g, " ")
        .split(/[\s/]+/)
        .filter((x) => x.length >= 2);
      const aliases = [...(FIELD_ALIASES[key] ?? []), ...labelKw];
      out[key] = matchField(names, aliases);
    }
    return out;
  };

    const [targetMapping, setTargetMapping] = useState<
    Record<string, string | undefined>
  >(() => {
    // 回退恢复：优先沿用上次的目标 BOM 列映射
    if (initialConfig?.targetMapping) {
      const names = new Set(targetFile?.headers.map((h) => h.name) ?? []);
      const restored: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(initialConfig.targetMapping)) {
        restored[k] = v && names.has(v) ? v : undefined;
      }
      // 补全缺失字段
      const picked = autoPick(targetFile, MAPPING_FIELDS.map((m) => m.key));
      for (const key of MAPPING_FIELDS.map((m) => m.key)) {
        if (!restored[key] && picked[key]) restored[key] = picked[key];
      }
      return restored;
    }
    return autoPick(targetFile, MAPPING_FIELDS.map((m) => m.key));
  });
  const [invMapping, setInvMapping] = useState<Record<string, string | undefined>>(
    () => {
      // 回退恢复：优先沿用上次的库存表列映射
      if (initialConfig?.inventoryMapping) {
        const inv = files.find((f) => f.storedName === inventoryStored);
        const names = new Set(inv?.headers.map((h) => h.name) ?? []);
        const restored: Record<string, string | undefined> = {
          codeColumn:
            initialConfig.inventoryMapping.codeColumn &&
            names.has(initialConfig.inventoryMapping.codeColumn)
              ? initialConfig.inventoryMapping.codeColumn
              : undefined,
          qtyColumn:
            initialConfig.inventoryMapping.qtyColumn &&
            names.has(initialConfig.inventoryMapping.qtyColumn)
              ? initialConfig.inventoryMapping.qtyColumn
              : undefined,
        };
        const picked = autoPick(inv, INV_FIELDS.map((m) => m.key));
        for (const key of INV_FIELDS.map((m) => m.key)) {
          if (!restored[key] && picked[key]) restored[key] = picked[key];
        }
        return restored;
      }
      const inv = files.find((f) => f.storedName === inventoryStored);
      return autoPick(inv, INV_FIELDS.map((m) => m.key));
    },
  );
  const [runPhase2, setRunPhase2] = useState(initialConfig?.runPhase2 ?? true);
  const [runPhase3, setRunPhase3] = useState(
    initialConfig?.runPhase3 ?? bomFiles.some((f) => roles[f.storedName] === "occupied"),
  );
  const [sheetUpdating, setSheetUpdating] = useState<Record<string, boolean>>({});
  // 预览弹窗目标文件（任务内 BOM）
  const [previewFile, setPreviewFile] = useState<ParsedFileDTO | null>(null);
  // 预览持久资源（库存表 / 工单表）
  const [previewKind, setPreviewKind] = useState<"inventory" | "work_order" | null>(null);
  // 切换目标 BOM 时：保留已选列，仅补全空缺（不覆盖用户已确认的映射）
  useEffect(() => {
    const picked = autoPick(targetFile, MAPPING_FIELDS.map((m) => m.key));
    setTargetMapping((prev) => {
      const next = { ...prev };
      for (const key of MAPPING_FIELDS.map((m) => m.key)) {
        if (!next[key] && picked[key]) next[key] = picked[key];
      }
      return next;
    });
  }, [targetFile?.storedName, targetFile?.mainSheet]);
  useEffect(() => {
    setInvMapping((prev) => {
      const picked = autoPick(inventoryFile, INV_FIELDS.map((m) => m.key));
      const next = { ...prev };
      for (const key of INV_FIELDS.map((m) => m.key)) {
        if (!next[key] && picked[key]) next[key] = picked[key];
      }
      return next;
    });
  }, [inventoryFile?.storedName, inventoryFile?.mainSheet]);

  const ensureMapping = () => {
    if (targetFile && Object.keys(targetMapping).length === 0) {
      setTargetMapping(autoPick(targetFile, MAPPING_FIELDS.map((m) => m.key)));
    }
  };

  const occupied = bomFiles.filter(
    (f) => roles[f.storedName] === "occupied" && f.storedName !== targetStored,
  );

  const totalRemovedCols = files.reduce(
    (s, f) => s + (f.removedColumnCount ?? 0),
    0,
  );
  const ignoredSheets = files.flatMap((f) => f.ignoredChangeLog ?? []);

  // 目标 BOM 缺少「一博物料编码」时禁止执行
  const targetMissingYibo = !!targetFile && !targetFile.hasYiboCode;
  // 库存表来自持久资源
  const inventoryReady = !!resources?.inventory.exists;
  const inventoryMappingReady = !!invMapping.codeColumn && !!invMapping.qtyColumn;
  const canExecute =
    !!targetStored &&
    !targetMissingYibo &&
    !!targetMapping.quantityColumn &&
    !!targetMapping.usageColumn &&
    !!targetMapping.bomCodeColumn &&
    (!inventoryReady || inventoryMappingReady);

  const handleSheetChange = async (storedName: string, sheetName: string) => {
    if (!sheetName) return;
    setSheetUpdating((prev) => ({ ...prev, [storedName]: true }));
    try {
      const res = await apiFetch("/api/bom/sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, storedName, sheetName }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "切换 sheet 失败");
      }
      onFileUpdated(data.file as ParsedFileDTO);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "切换 sheet 失败，请稍后重试";
      window.alert(message);
    } finally {
      setSheetUpdating((prev) => ({ ...prev, [storedName]: false }));
    }
  };

  const handleExecute = () => {
    if (!targetStored) return;
    ensureMapping();
    onExecute({
      targetStoredName: targetStored,
      targetSets: sets[targetStored] ?? 1,
      targetMapping,
      inventoryStoredName: inventoryStored || undefined,
      inventoryMapping: {
        codeColumn: invMapping.codeColumn,
        qtyColumn: invMapping.qtyColumn,
      },
      occupied: occupied.map((f) => ({
        storedName: f.storedName,
        sets: sets[f.storedName] ?? 1,
      })),
      workOrderStoredName: workOrderStored || undefined,
      runPhase2,
      runPhase3,
      __roles: roles,
      setsMap: sets,
    });
  };

  return (
    <div className="space-y-5">
      {/* 清洗预处理汇总 */}
      {(totalRemovedCols > 0 || ignoredSheets.length > 0) && (
        <div className="rounded-lg border border-[#dadce0] bg-[#e8f0fe] px-4 py-3 text-sm text-[#174ea6]">
          <div className="flex items-center gap-2 font-medium">🧹 数据已清洗并转换为 CSV</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {ignoredSheets.length > 0 && (
              <li>
                • 已忽略 Change Log 工作表：
                {ignoredSheets.map((s, i) => (
                  <span
                    key={i}
                    className="ml-1 rounded bg-white/70 px-1.5 py-0.5 font-medium"
                  >
                    {s}
                  </span>
                ))}
              </li>
            )}
            {totalRemovedCols > 0 && (
              <li>• 已剔除 {totalRemovedCols} 个空列 / 仅含颜色标记无字符的无意义列</li>
            )}
          </ul>
        </div>
      )}

{/* 库存表（持久资源，每日更新） */}
      <Section
        title="库存表"
        desc="用于匹配的物料库存查询表（数据资源，每日更新）"
      >
        {inventoryFile ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#f8f9fa] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-base">📦</span>
                <div>
                  <div className="text-sm font-medium text-[#202124]">
                    {inventoryFile.originalName}
                  </div>
                  <div className="text-xs text-[#9aa0a6]">
                    {inventoryFile.mainSheet} · {inventoryFile.rowCount} 行
                    {resources?.inventory.updatedToday
                      ? " · ✓ 今日已更新"
                      : " · ⚠ 需更新"}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setPreviewKind("inventory")}
                className="rounded-full border border-[#dadce0] px-3 py-1 text-xs font-medium text-[#1a73e8] transition hover:bg-[#e8f0fe]"
              >
                👁 预览
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {INV_FIELDS.map((field) => (
                <ColumnSelect
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  value={invMapping[field.key]}
                  options={inventoryFile.headers}
                  onChange={(v) =>
                    setInvMapping((p) => ({ ...p, [field.key]: v }))
                  }
                />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-[#d93025]">
            尚未上传库存表，请返回「上传」步骤更新数据资源。
          </p>
        )}
      </Section>

 {/* 工单调拨齐套报表（持久资源，每日更新） */}
      <Section
        title="工单调拨齐套报表"
        desc="用于判断已占用 BOM 的生产是否已在工单中确认（数据资源，每日更新）"
      >
        {workOrderFile ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#f8f9fa] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-base">📋</span>
              <div>
                <div className="text-sm font-medium text-[#202124]">
                  {workOrderFile.originalName}
                </div>
                <div className="text-xs text-[#9aa0a6]">
                  {workOrderFile.mainSheet} · {workOrderFile.rowCount} 行
                  {resources?.workOrder.updatedToday
                    ? " · ✓ 今日已更新"
                    : " · ⚠ 需更新"}
                </div>
              </div>
            </div>
            <button
              onClick={() => setPreviewKind("work_order")}
              className="rounded-full border border-[#dadce0] px-3 py-1 text-xs font-medium text-[#1a73e8] transition hover:bg-[#e8f0fe]"
            >
              👁 预览
            </button>
          </div>
        ) : (
          <p className="text-sm text-[#d93025]">
            尚未上传工单报表，请返回「上传」步骤更新数据资源。
          </p>
        )}
        {workOrderFile && occupied.length > 0 && (
          <p className="mt-2 text-xs text-[#5f6368]">
            ✓ 将检查工单中「成品名称」是否包含各已占用 BOM 的产品名（如
            S801CPR、S801XHC32PA），且「计划数量」与套数一致时跳过该 BOM 的扣减。
          </p>
        )}
      </Section>

      {/* BOM 角色与套数 */}
      <Section title="BOM 角色与生产套数" desc="为每个 BOM 文件指派角色并填写生产套数">
        <div className="overflow-hidden rounded-lg border border-[#dadce0]">
          <table className="w-full text-sm">
            <thead className="bg-[#f8f9fa] text-[#5f6368]">
              <tr>
                <th className="px-4 py-2 text-left font-medium">文件名</th>
                <th className="px-4 py-2 text-left font-medium">角色</th>
                <th className="px-4 py-2 text-left font-medium">套数</th>
                <th className="px-4 py-2 text-left font-medium">计算 Sheet</th>
                <th className="px-4 py-2 text-left font-medium">一博编码</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e1e3e6]">
              {bomFiles.map((f) => (
                <tr key={f.storedName} className="bg-white">
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => setPreviewFile(f)}
                      className="group text-left"
                      title="点击预览该表数据"
                    >
                      <div className="font-medium text-[#1a73e8] group-hover:underline">
                        {f.originalName}
                      </div>
                      <div className="text-xs text-[#9aa0a6]">
                        {f.mainSheet} · {f.rowCount} 行 · 👁 预览
                      </div>
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={roles[f.storedName]}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRoles((prev) => {
                          const next = { ...prev };
                          if (val === "target") {
                            for (const k of Object.keys(next)) {
                              if (next[k] === "target") next[k] = "occupied";
                            }
                          }
                          next[f.storedName] = val;
                          return next;
                        });
                        if (val === "target") {
                          setTargetMapping(
                            autoPick(f, MAPPING_FIELDS.map((m) => m.key)),
                          );
                        }
                      }}
                      className="rounded-md border border-[#dadce0] bg-white px-2 py-1.5 text-sm focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8]"
                    >
                      <option value="target">🎯 目标 BOM</option>
                      <option value="occupied">📋 已占用客供库存 BOM</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="number"
                      min={1}
                      value={sets[f.storedName] ?? 1}
                      onChange={(e) =>
                        setSets((p) => ({
                          ...p,
                          [f.storedName]: Math.max(
                            1,
                            Number(e.target.value) || 1,
                          ),
                        }))
                      }
                      className="w-20 rounded-md border border-[#dadce0] px-2 py-1.5 text-sm focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8]"
                    />
                    <span className="ml-1 text-xs text-[#9aa0a6]">套</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <SheetSelect
                      label="BOM Sheet"
                      hideLabel
                      value={f.mainSheet}
                      sheets={f.sheets}
                      disabled={processing || !!sheetUpdating[f.storedName]}
                      onChange={(sheetName) =>
                        handleSheetChange(f.storedName, sheetName)
                      }
                    />
                    <div className="mt-1 text-xs text-[#9aa0a6]">
                      当前计算 sheet：{f.mainSheet}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {f.hasYiboCode ? (
                      <span className="inline-flex items-center rounded-full bg-[#e6f4ea] px-2 py-0.5 text-xs font-medium text-[#137333]">
                        ✓ 含
                      </span>
                    ) : (
                      <span className="inline-flex animate-pulse items-center rounded-full bg-[#fce8e6] px-2.5 py-0.5 text-xs font-bold text-[#d93025] ring-1 ring-[#d93025]/40">
                        ⚠ 一博物料编码缺失
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 列映射 */}
      {targetFile && (
        <Section
          title="目标 BOM 列映射"
          desc={`${targetFile.originalName}（已自动识别，可调整）`}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {MAPPING_FIELDS.map((field) => (
              <ColumnSelect
                key={field.key}
                label={field.label}
                required={field.required}
                hint={field.hint}
                value={targetMapping[field.key]}
                options={targetFile.headers}
                onChange={(v) =>
                  setTargetMapping((p) => ({ ...p, [field.key]: v }))
                }
              />
            ))}
          </div>
        </Section>
      )}

      {/* 执行阶段 */}
      <Section title="执行阶段" desc="按需勾选要执行的工作流阶段">
        <div className="space-y-2">
          <Toggle checked disabled label="阶段一 · BOM 库存匹配与供料方式判定（必选）" />
          <Toggle
            checked={runPhase2}
            onChange={setRunPhase2}
            label="阶段二 · 一博问题与零件状态标记"
          />
          <Toggle
            checked={runPhase3}
            onChange={setRunPhase3}
            label="阶段三 · 已占用客供库存扣减（需已占用 BOM）"
            disabled={occupied.length === 0}
          />
        </div>
      </Section>

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          disabled={processing}
          className="rounded-full border border-[#dadce0] bg-white px-5 py-2 text-sm font-medium text-[#3c4043] transition hover:bg-[#f1f3f4] disabled:opacity-50"
        >
          ← 重新上传
        </button>
        <button
          onClick={handleExecute}
          disabled={!canExecute || processing}
          className="flex items-center gap-2 rounded-full bg-[#1a73e8] px-6 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#1765cc] disabled:cursor-not-allowed disabled:bg-[#dadce0]"
        >
          {processing && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          {processing ? "执行中…" : "开始匹配"}
        </button>
      </div>
  {targetMissingYibo && (
        <div className="flex items-start gap-2 rounded-lg border-2 border-[#d93025]/50 bg-[#fce8e6] p-3 text-sm text-[#a50e0e]">
          <span className="leading-none">🚫</span>
          <div>
            目标 BOM 缺少「一博物料编码」列，无法获取一博库存信息，请返回上传含该列的文件后再执行。
          </div>
        </div>
      )}
      {!canExecute && !targetMissingYibo && (
        <p className="text-right text-xs text-[#d93025]">
          请补全必选列映射（Quantity、单机用量、物料编码
          {invFiles.length ? "、库存表列" : ""}）
        </p>
      )}
      {/* 预览弹窗 */}
       {previewFile && (
        <SheetPreviewModal
          jobId={jobId}
          storedName={previewFile.storedName}
          originalName={previewFile.originalName}
          onClose={() => setPreviewFile(null)}
        />
      )}
      {previewKind && (
        <SheetPreviewModal
          kind={previewKind}
          originalName={
            previewKind === "inventory"
              ? resources?.inventory.file?.originalName ?? "库存表"
              : resources?.workOrder.file?.originalName ?? "工单报表"
          }
          onClose={() => setPreviewKind(null)}
        />
      )}
    </div>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#dadce0] bg-white p-5">
      <h3 className="text-base font-bold text-[#202124]">{title}</h3>
      {desc && <p className="mt-0.5 text-xs text-[#5f6368]">{desc}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ColumnSelect({
  label,
  required,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  value?: string;
  options: { col: number; name: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-base font-bold text-[#202124]">
        {label}
        {required && <span className="ml-1 text-[#d93025]">*</span>}
      </span>
      {hint && <span className="block text-xs text-[#9aa0a6]">{hint}</span>}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-[#dadce0] bg-white px-2.5 py-1.5 text-sm focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8]"
      >
        <option value="">— 未选择 —</option>
        {options.map((o) => (
          <option key={o.col} value={o.name}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SheetSelect({
  label,
  value,
  sheets,
  onChange,
  disabled,
  hideLabel,
}: {
  label: string;
  value: string;
  sheets: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <label className="block">
      {!hideLabel && (
        <span className="text-sm font-medium text-[#3c4043]">{label}</span>
      )}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${hideLabel ? "" : "mt-1 "}w-full rounded-md border border-[#dadce0] bg-white px-2.5 py-1.5 text-sm focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8] disabled:cursor-not-allowed disabled:bg-[#f8f9fa]`}
      >
        {sheets.map((sheet) => (
          <option key={sheet} value={sheet}>
            {sheet}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
        checked
          ? "border-[#1a73e8]/30 bg-[#e8f0fe]/50 text-[#202124]"
          : "border-[#dadce0] bg-white text-[#5f6368]"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="h-4 w-4 rounded border-[#dadce0] text-[#1a73e8] focus:ring-[#1a73e8]"
      />
      {label}
    </label>
  );
}