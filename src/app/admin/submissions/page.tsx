export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import Link from "next/link";
import AutoRefreshOnFocus from "../AutoRefreshOnFocus";

// ── types & helpers ──────────────────────────────────────────────
type AdminStatus =
  | "RECEIVED"
  | "GRADING"
  | "ADJUSTED"
  | "APPROVED"
  | "REJECTED"
  | "PAID";

const KNOWN: Record<AdminStatus, true> = {
  RECEIVED: true,
  GRADING: true,
  ADJUSTED: true,
  APPROVED: true,
  REJECTED: true,
  PAID: true,
};

const normalize = (s: string): AdminStatus =>
  (KNOWN as any)[s] ? (s as AdminStatus) : "RECEIVED";

const statusClass = (s: AdminStatus) => {
  switch (s) {
    case "RECEIVED":
      return "bg-yellow-100 text-yellow-700";
    case "GRADING":
      return "bg-blue-100 text-blue-700";
    case "ADJUSTED":
      return "bg-orange-100 text-orange-700";
    case "APPROVED":
      return "bg-emerald-100 text-emerald-700";
    case "PAID":
      return "bg-green-100 text-green-700";
    case "REJECTED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
};

const shortRef = (id: string) => id.slice(0, 8);
const euroCents = (cents: number) => (cents / 100).toFixed(2);

// ── page (server component) ─────────────────────────────────────
export default async function AdminSubmissionsPage() {
  const submissions = await prisma.submission.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: true }, // nodig voor fallback totalen
  });

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* ververst de pagina zodra je terug navigeert */}
      <AutoRefreshOnFocus />

      <h1 className="text-2xl font-bold mb-4">Buylist Submissions</h1>

      <table className="min-w-full text-sm border">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left p-2">ID</th>
            <th className="text-left p-2">Email</th>
            <th className="text-left p-2">Items</th>
            <th className="text-left p-2">Totaal (€)</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Datum</th>
            <th className="text-left p-2"></th>
          </tr>
        </thead>
        <tbody>
          {submissions.map((s) => {
            // subtotalCents kan ontbreken — val terug op som van lineCents
            const subtotalCents =
              typeof (s as any).subtotalCents === "number"
                ? (s as any).subtotalCents
                : s.items.reduce(
                    (sum, i) => sum + Number(i.lineCents ?? 0),
                    0
                  );

            const st = normalize(s.status);

            return (
              <tr key={s.id} className="border-t">
                <td className="p-2">
                  <Link
                    href={`/admin/submissions/${s.id}`}
                    className="underline"
                    title={s.id}
                  >
                    {shortRef(s.id)}
                  </Link>
                </td>
                <td className="p-2">{s.email ?? "—"}</td>
                <td className="p-2">{s.items.length}</td>
                <td className="p-2">{euroCents(subtotalCents)}</td>
                <td className="p-2">
                  <span className={`px-2 py-1 rounded ${statusClass(st)}`}>
                    {st}
                  </span>
                </td>
                <td className="p-2">
                  {new Date(s.createdAt as unknown as string).toLocaleString(
                    "nl-NL"
                  )}
                </td>
                <td className="p-2">
                  <Link
                    href={`/admin/submissions/${s.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    Details →
                  </Link>
                </td>
              </tr>
            );
          })}

          {submissions.length === 0 && (
            <tr>
              <td className="p-2" colSpan={7}>
                Geen submissions gevonden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
