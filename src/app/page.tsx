import Nav from "@/components/app/Nav";
import Dashboard from "@/components/app/Dashboard";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      <Nav />
      <Dashboard />
    </main>
  );
}
