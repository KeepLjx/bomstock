import Nav from "@/components/app/Nav";
import LogsView from "@/components/app/LogsView";

export const dynamic = "force-dynamic";

export default function LogsPage() {
  return (
    <main className="min-h-screen bg-white">
      <Nav />
      <LogsView />
    </main>
  );
}
