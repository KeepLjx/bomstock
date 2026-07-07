import Wizard from "@/components/bom/Wizard";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      {/* 顶部栏 */}
      <header className="sticky top-0 z-30 border-b border-[#dadce0] bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-[90%] max-w-[1800px] items-center justify-between py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1a73e8] text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
            </div>
            <span className="text-[15px] font-medium text-[#202124]">
              BOM 库存匹配
            </span>
          </div>
          <a
            href="/history"
            className="rounded-full px-3 py-1.5 text-sm font-medium text-[#1a73e8] transition hover:bg-[#f1f3f4]"
          >
            历史任务
          </a>
        </div>
      </header>

      <div className="mx-auto w-[90%] max-w-[1800px] py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-normal text-[#202124]">
            BOM 库存匹配与供料方式判定
          </h1>
          <p className="mt-1 text-sm text-[#5f6368]">
            上传 BOM 与库存表，自动匹配供料方式，结果可在网页表格中直接编辑并导出。
          </p>
        </div>
        <Wizard />
      </div>
    </main>
  );
}
