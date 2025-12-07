export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import StatusEditor from "../StatusEditor"; // ⬅ vanuit parent-map

const euro = (cents: number) => (cents / 100).toFixed(2);

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!submission) return notFound();

  const totalCents =
    (submission as any).serverTotalCents ??
    submission.items.reduce(
      (s, i) => s + Number(i.lineCents ?? 0),
      0
    );

  const cmIds = Array.from(
    new Set(
      submission.items
        .map((i) => Number(i.productId))
        .filter((n) => Number.isFinite(n))
    )
  ) as number[];

  const lookups = cmIds.length
    ? await prisma.scryfallLookup.findMany({
        where: { cardmarketId: { in: cmIds } },
        select: { cardmarketId: true, name: true, set: true },
      })
    : [];

  const nameById = new Map<
    number,
    { name: string; set: string | null }
  >();
  for (const r of lookups) {
    nameById.set(r.cardmarketId as number, {
      name: r.name,
      set: r.set,
    });
  }

  const enriched = submission.items
    .map((item) => {
      const cmId = Number(item.productId);
      const meta = nameById.get(cmId);
      const base = meta
        ? `${meta.name}${meta.set ? ` [${meta.set.toUpperCase()}]` : ""}`
        : `#${cmId}`;
      const label = `${base}${item.isFoil ? " (Foil)" : ""}`;

      return {
        id: item.id,
        label,
        cmId,
        qty: item.qty,
        unitCents: Number(item.unitCents ?? 0),
        lineCents: Number(item.lineCents ?? 0),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4">
        <Link href="/admin/submissions" className="text-blue-600 underline">
          ← Terug naar overzicht
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-2">
        Submission {submission.id}
      </h1>
      <p className="mb-1">
        {submission.email ?? "—"} · status:{" "}
        <strong>{submission.status}</strong>
      </p>
      <p className="mb-4">
        Totaal (server): € {euro(totalCents)} · Items:{" "}
        {submission.items.length}
      </p>

      <div className="mb-4">
        <StatusEditor
          id={submission.id}
          initialStatus={submission.status}
        />
      </div>

      <h2 className="text-lg font-semibold mb-2">Items</h2>
      <table className="min-w-full text-sm border">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left p-2">Kaart</th>
            <th className="text-right p-2">Qty</th>
            <th className="text-right p-2">Unit (€)</th>
            <th className="text-right p-2">Line (€)</th>
          </tr>
        </thead>
        <tbody>
          {enriched.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="p-2">
                {row.label}
                <div className="text-xs text-gray-500">
                  #{row.cmId}
                </div>
              </td>
              <td className="p-2 text-right">{row.qty}</td>
              <td className="p-2 text-right">
                € {euro(row.unitCents)}
              </td>
              <td className="p-2 text-right">
                € {euro(row.lineCents)}
              </td>
            </tr>
          ))}

          {enriched.length === 0 && (
            <tr>
              <td className="p-2" colSpan={4}>
                Geen items.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
