export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import Link from "next/link";
import AutoRefreshOnFocus from "../AutoRefreshOnFocus";

type AdminStatus =
  | "SUBMITTED"
  | "RECEIVED"
  | "GRADING"
  | "ADJUSTED"
  | "APPROVED"
  | "REJECTED"
  | "PAID";

const OPEN_STATUSES: AdminStatus[] = [
  "SUBMITTED",
  "RECEIVED",
  "GRADING",
  "ADJUSTED",
];

const STATUS_LABEL: Record<AdminStatus, string> = {
  SUBMITTED: "Ingediend",
  RECEIVED: "Ontvangen",
  GRADING: "Grading",
  ADJUSTED: "Aangepast",
  APPROVED: "Goedgekeurd",
  REJECTED: "Afgekeurd",
  PAID: "Betaald",
};

const STATUS_CLASS: Record<AdminStatus, string> = {
  SUBMITTED: "bg-sky-100 text-sky-800 border-sky-300",
  RECEIVED: "bg-amber-100 text-amber-800 border-amber-300",
  GRADING: "bg-blue-100 text-blue-800 border-blue-300",
  ADJUSTED: "bg-orange-100 text-orange-800 border-orange-300",
  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-300",
  REJECTED: "bg-red-100 text-red-800 border-red-300",
  PAID: "bg-green-100 text-green-800 border-green-300",
};

const shortRef = (id: string) => id.slice(0, 8);
const euroCents = (cents: number) => (cents / 100).toFixed(2);

export default async function AdminSubmissionsPage() {
  const submissions = await prisma.submission.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { items: true },
  });

  const sorted = [...submissions].sort((a, b) => {
    const aOpen = OPEN_STATUSES.includes(a.status as AdminStatus);
    const bOpen = OPEN_STATUSES.includes(b.status as AdminStatus);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const openCount = submissions.filter((s) =>
    OPEN_STATUSES.includes(s.status as AdminStatus)
  ).length;

  return (
    <div className="p-4">
      <AutoRefreshOnFocus />

      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold mb-1">Buylist Submissions</h1>
        <p className="text-sm text-slate-600 mb-4">
          Laatste 100 inzendingen. Openstaand:{" "}
          <span className="font-semibold text-amber-700">{openCount}</span>
        </p>

        <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600 flex justify-between">
            <span>
              Open: SUBMITTED / RECEIVED / GRADING / ADJUSTED
            </span>
            <span className="hidden md:inline">
              Klik op een rij voor details en statuswijziging.
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs md:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-slate-700">
                  <th className="text-left px-3 py-2 font-medium">Ref</th>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-right px-3 py-2 font-medium">
                    Items
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    Totaal (€)
                  </th>
                  <th className="text-left px-3 py-2 font-medium">
                    Status
                  </th>
                  <th className="text-left px-3 py-2 font-medium">
                    Datum
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => {
                  const subtotalCents =
                    typeof (s as any).subtotalCents === "number"
                      ? (s as any).subtotalCents
                      : s.items.reduce(
                          (sum, i) => sum + Number(i.lineCents ?? 0),
                          0
                        );

                  const st = (s.status || "SUBMITTED") as AdminStatus;
                  const label =
                    STATUS_LABEL[st] ?? s.status ?? "Onbekend";
                  const classes =
                    STATUS_CLASS[st] ??
                    "bg-slate-100 text-slate-800 border-slate-300";

                  const created =
                    s.createdAt instanceof Date
                      ? s.createdAt
                      : new Date(s.createdAt as any);

                  const isOpen = OPEN_STATUSES.includes(st);

                  return (
                    <tr
                      key={s.id}
                      className={`border-t border-slate-200 hover:bg-slate-50 transition-colors ${
                        isOpen ? "" : "opacity-80"
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-[11px] md:text-xs">
                       <Link
  href={`/admin/submissions/${s.id}`}
  className="underline text-slate-200 hover:text-[#C9A24E]"
  title={s.id}
>
  {shortRef(s.id)}
</Link>

                      </td>
                      <td className="px-3 py-2">
                        {s.email ?? (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.items.length}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {euroCents(subtotalCents)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] md:text-xs font-medium ${classes}`}
                        >
                          {isOpen && (
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          )}
                          {label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {created.toLocaleString("nl-NL", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/admin/submissions/${s.id}`}
                          className="text-sky-700 hover:text-sky-900 text-xs md:text-sm"
                        >
                          Details →
                        </Link>
                      </td>
                    </tr>
                  );
                })}

                {sorted.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-4 text-center text-slate-500"
                      colSpan={7}
                    >
                      Geen submissions gevonden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
