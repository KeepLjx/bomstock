import Nav from "@/components/app/Nav";
import Wizard from "@/components/bom/Wizard";

export const dynamic = "force-dynamic";

export default function WorkflowPage() {
  return (
    <main className="min-h-screen bg-white">
      <Nav />
      <div className="mx-auto w-[90%] max-w-[1800px] py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-normal text-[#202124]">BOM 库存匹配与供料方式判定</h1>
          <p className="mt-1 text-sm text-[#5f6368]">
            目标 BOM 就地插入分析列，匹配库存/已占用 BOM/工单，结果可在网页表格中编辑并导出。
          </p>
        </div>
        <Wizard />
      </div>
    </main>
  );
}
