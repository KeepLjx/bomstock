import Nav from "@/components/app/Nav";
import RealtimeInventory from "@/components/app/RealtimeInventory";

export const dynamic = "force-dynamic";

export default function InventoryPage() {
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-white">
      <div className="shrink-0">
        <Nav />
      </div>
      <div className="min-h-0 flex-1">
        <RealtimeInventory />
      </div>
    </main>
  );
}
