import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid grid-cols-[220px_1fr]">
      <aside className="border-r p-4 space-y-3">
        <div className="text-lg font-semibold">Admin</div>
        <nav className="flex flex-col gap-2 text-sm">
          <Link href="/admin">Dashboard</Link>
          <div className="mt-2 font-semibold">Tools</div>
          <Link href="/admin/tools/apply-sales">Apply Sales</Link>
          <Link href="/admin/exports/post-sales">Post-Sales Export</Link>
          <Link href="/admin/exports/idle">Idle Export</Link>
          {/* voeg later meer items toe */}
        </nav>
      </aside>
      <main className="p-6">{children}</main>
    </div>
  );
}
