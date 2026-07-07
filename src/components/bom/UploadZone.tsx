"use client";

import { useCallback, useRef, useState } from "react";
import type { UploadResponse } from "./types";

interface Props {
  onUploaded: (res: UploadResponse) => void;
  onError: (msg: string) => void;
}

export default function UploadZone({ onUploaded, onError }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) =>
        /\.(xlsx|xlsm|xls)$/i.test(f.name),
      );
      if (files.length === 0) {
        onError("请选择 Excel 文件（.xlsx / .xlsm）");
        return;
      }
      setUploading(true);
      try {
        const fd = new FormData();
        for (const f of files) fd.append("files", f);
        const res = await fetch("/api/bom/upload", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) {
          onError(data.error || "上传失败");
          return;
        }
        onUploaded(data as UploadResponse);
      } catch (e) {
        onError(`上传失败：${(e as Error).message}`);
      } finally {
        setUploading(false);
      }
    },
    [onUploaded, onError],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* 左：上传区 */}
      <div className="lg:col-span-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length > 0) upload(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex h-full min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-8 py-12 text-center transition ${
            dragOver
              ? "border-[#1a73e8] bg-[#e8f0fe]"
              : "border-[#dadce0] bg-[#f8f9fa] hover:border-[#1a73e8] hover:bg-[#f1f3f4]"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".xlsx,.xlsm,.xls"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) upload(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f0fe] text-[#1a73e8]">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p className="mt-4 text-base font-medium text-[#202124]">
            {uploading ? "正在解析文件…" : "拖放文件到此处，或点击选择"}
          </p>
          <p className="mt-1 text-sm text-[#5f6368]">
            支持 .xlsx / .xlsm · 可同时上传 BOM、库存等多个文件
          </p>
          {uploading && (
            <div className="mt-4 h-1 w-48 overflow-hidden rounded-full bg-[#dadce0]">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-[#1a73e8]" />
            </div>
          )}
        </div>
      </div>

      {/* 右：说明 */}
      <div className="lg:col-span-2">
        <div className="h-full rounded-2xl border border-[#dadce0] bg-white p-6">
          <h3 className="text-sm font-medium text-[#202124]">使用说明</h3>
          <ol className="mt-4 space-y-3 text-sm text-[#5f6368]">
            <Step n={1} title="上传文件">
              目标 BOM（须含「一博物料编码」列）、物料库存查询表，及可选的已占用 BOM。
            </Step>
            <Step n={2} title="确认配置">
              指派 BOM 角色、填写生产套数、核对列映射。
            </Step>
            <Step n={3} title="查看与编辑">
              在结果表格中直接编辑单元格，导出带颜色标记的 XLSX。
            </Step>
          </ol>
          <div className="mt-5 rounded-lg bg-[#e8f0fe] p-3 text-xs leading-relaxed text-[#174ea6]">
            自动清洗：忽略 Change Log 工作表，剔除空列与仅含颜色的无意义列，转为 CSV 后匹配。
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#1a73e8] text-xs font-medium text-white">
        {n}
      </span>
      <div>
        <div className="font-medium text-[#202124]">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[#5f6368]">
          {children}
        </div>
      </div>
    </li>
  );
}
