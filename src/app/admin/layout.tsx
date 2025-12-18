import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container"; // ⬅️ nieuw

const links = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/submissions", label: "Submissions" },
  { href: "/admin/tools/apply-sales", label: "Apply Sales" },
  { href: "/admin/exports/post-sales", label: "Relist & New Stock Export" },
  { href: "/admin/exports/idle", label: "Idle Export" },
  { href: "/admin/inventory", label: "Inventory overview" },
  { href: "/admin/stock-in", label: "Stock in" },
  { href: "/admin/tools/oversell", label: "Oversell" },
  { href: "/admin/tools/cm-stock-audit", label: "cm-stock-audit" },
  { href: "/admin/tools/arbitrage", label: "arbitrage" },
  
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar links */}
      <aside className="w-52 p-4 border-r border-border bg-card">
        <nav className="flex flex-col space-y-1 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Hoofdinhoud */}
      <main className="flex-1 py-6">
        <PageContainer>
          {children}
        </PageContainer>
      </main>
    </div>
  );
}
