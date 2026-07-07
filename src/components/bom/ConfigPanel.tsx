"use client";

import { useMemo, useState } from "react";
import { type ParsedFileDTO } from "./types";

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
}

interface Props {
  files: ParsedFileDTO[];
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

export default function ConfigPanel({
  files,
  onExecute,
  onBack,
  processing,
}: Props) {
  const bomFiles = files.filter((f) => f.kind === "bom");
  const invFiles = files.filter((f) => f.kind === "inventory");
  const transferFiles = files.filter((f) => f.kind === "transfer");

  // 角色状态
  const [roles, setRoles] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    let targetAssigned = false;
    for (const f of bomFiles) {
      if (f.role === "target" && !targetAssigned) {
        m[f.storedName] = "target";
        targetAssigned = true;
      } else {
        m[f.storedName] = "occupied";
      }
    }
    if (!targetAssigned && bomFiles[0]) m[bomFiles[0].storedName] = "target";
    return m;
  });
  const [sets, setSets] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const f of bomFiles) m[f.storedName] = 1;
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

  const autoPick = (
    file: ParsedFileDTO | undefined,
    keys: string[],
  ): Record<string, string | undefined> => {
    const out: Record<string, string | undefined> = {};
    if (!file) return out;
    const names = file.headers.map((h) => h.name);
    for (const key of keys) {
      const def = MAPPING_FIELDS.find((m) => m.key === key);
      const label = def?.label ?? key;
      const kw = label
        .replace(/[（）()/]/g, " ")
        .split(/[\s/]+/)
        .filter((x) => x.length >= 2);
      const found = names.find((n) =>
        kw.some(
          (k) => n.includes(k) || n.toLowerCase().includes(k.toLowerCase()),
        ),
      );
      out[key] = found;
    }
    return out;
  };

  const [targetMapping, setTargetMapping] = useState<
    Record<string, string | undefined>
  >(() => autoPick(targetFile, MAPPING_FIELDS.map((m) => m.key)));

  const [invMapping, setInvMapping] = useState<Record<string, string | undefined>>(
    () => {
      const inv = files.find((f) => f.storedName === inventoryStored);
      return autoPick(inv, INV_FIELDS.map((m) => m.key));
    },
  );

  const [runPhase2, setRunPhase2] = useState(true);
  const [runPhase3, setRunPhase3] = useState(
    bomFiles.some((f) => roles[f.storedName] === "occupied"),
  );

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

  const canExecute =
    !!targetStored &&
    !!targetMapping.quantityColumn &&
    !!targetMapping.usageColumn &&
    !!targetMapping.bomCodeColumn &&
    (!invFiles.length ||
      (!!inventoryStored && !!invMapping.codeColumn && !!invMapping.qtyColumn));

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

      {/* 库存表 */}
      {invFiles.length > 0 && (
        <Section title="库存表" desc="选择用于匹配的物料库存查询表">
          <div className="flex flex-wrap gap-2">
            {invFiles.map((f) => (
              <button
                key={f.storedName}
                onClick={() => setInventoryStored(f.storedName)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  inventoryStored === f.storedName
                    ? "border-[#1a73e8] bg-[#e8f0fe] text-[#174ea6]"
                    : "border-[#dadce0] bg-white text-[#5f6368] hover:bg-[#f1f3f4]"
                }`}
              >
                📦 {f.originalName}
                <span className="ml-2 text-xs opacity-60">{f.rowCount} 行</span>
              </button>
            ))}
          </div>
          {inventoryStored && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {INV_FIELDS.map((field) => (
                <ColumnSelect
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  value={invMapping[field.key]}
                  options={
                    files.find((f) => f.storedName === inventoryStored)
                      ?.headers ?? []
                  }
                  onChange={(v) =>
                    setInvMapping((p) => ({ ...p, [field.key]: v }))
                  }
                />
              ))}
            </div>
          )}
        </Section>
      )}

      {/* 工单调拨齐套报表（扣减特殊判断） */}
      {transferFiles.length > 0 && (
        <Section
          title="工单调拨齐套报表（可选）"
          desc="用于判断已占用 BOM 的生产是否已在工单中确认（确认则不扣减其用量）"
        >
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setWorkOrderStored("")}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                !workOrderStored
                  ? "border-[#1a73e8] bg-[#e8f0fe] text-[#174ea6]"
                  : "border-[#dadce0] bg-white text-[#5f6368] hover:bg-[#f1f3f4]"
              }`}
            >
              不使用
            </button>
            {transferFiles.map((f) => (
              <button
                key={f.storedName}
                onClick={() => setWorkOrderStored(f.storedName)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  workOrderStored === f.storedName
                    ? "border-[#1a73e8] bg-[#e8f0fe] text-[#174ea6]"
                    : "border-[#dadce0] bg-white text-[#5f6368] hover:bg-[#f1f3f4]"
                }`}
              >
                📋 {f.originalName}
              </button>
            ))}
          </div>
          {workOrderStored && occupied.length > 0 && (
            <p className="mt-2 text-xs text-[#5f6368]">
              ✓ 将检查工单中「成品名称」是否包含各已占用 BOM 的产品名（如
              S801CPR、S801XHC32PA），且「计划数量」与套数一致时跳过该 BOM 的扣减。
            </p>
          )}
        </Section>
      )}

      {/* BOM 角色与套数 */}
      <Section title="BOM 角色与生产套数" desc="为每个 BOM 文件指派角色并填写生产套数">
        <div className="overflow-hidden rounded-lg border border-[#dadce0]">
          <table className="w-full text-sm">
            <thead className="bg-[#f8f9fa] text-[#5f6368]">
              <tr>
                <th className="px-4 py-2 text-left font-medium">文件名</th>
                <th className="px-4 py-2 text-left font-medium">角色</th>
                <th className="px-4 py-2 text-left font-medium">套数</th>
                <th className="px-4 py-2 text-left font-medium">一博编码</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e1e3e6]">
              {bomFiles.map((f) => (
                <tr key={f.storedName} className="bg-white">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-[#202124]">{f.originalName}</div>
                    <div className="text-xs text-[#9aa0a6]">
                      {f.mainSheet} · {f.rowCount} 行
                    </div>
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
                    {f.hasYiboCode ? (
                      <span className="inline-flex items-center rounded-full bg-[#e6f4ea] px-2 py-0.5 text-xs font-medium text-[#137333]">
                        ✓ 含
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-[#fef7e0] px-2 py-0.5 text-xs font-medium text-[#b06000]">
                        ⚠ 缺失
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
      {!canExecute && (
        <p className="text-right text-xs text-[#d93025]">
          请补全必选列映射（Quantity、单机用量、物料编码
          {invFiles.length ? "、库存表列" : ""}）
        </p>
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
      <h3 className="text-sm font-medium text-[#202124]">{title}</h3>
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
      <span className="text-sm font-medium text-[#3c4043]">
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
