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

  // ---- kaart-meta ophalen voor labels ----
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
        select: {
          cardmarketId: true,
          name: true,
          set: true,
          collectorNumber: true,
        },
      })
    : [];

  const nameById = new Map<
    number,
    { name: string; set: string | null; collectorNumber: string | null }
  >();
  for (const r of lookups) {
    nameById.set(r.cardmarketId as number, {
      name: r.name,
      set: r.set,
      collectorNumber: (r.collectorNumber as string | null) ?? null,
    });
  }

  const enriched = submission.items
    .map((item) => {
      const cmId = Number(item.productId);
      const meta = nameById.get(cmId);
      const base = meta
        ? `${meta.name}${
            meta.set ? ` [${meta.set.toUpperCase()}]` : ""
          }${meta.collectorNumber ? ` #${meta.collectorNumber}` : ""}`
        : `#${cmId}`;

      const cond = (item.condition as string | null) ?? "NM";

      const label = `${base}${item.isFoil ? " (Foil)" : ""} • ${cond}`;

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

  // ---- nette teksten voor payout / shipping ----
  let payoutLine = "Onbekend";
  if (submission.payoutMethod === "BANK") {
    payoutLine = `Bankoverschrijving (IBAN: ${
      submission.iban || "–"
    })`;
  } else if (submission.payoutMethod === "PAYPAL") {
    payoutLine = `PayPal (${
      submission.paypalEmail || submission.email || "–"
    })`;
  }

  let shippingLine = "Onbekend / niet ingevuld";
  if (submission.shippingMethod === "SELF") {
    shippingLine = "Klant verstuurt zelf (eigen risico)";
  } else if (submission.shippingMethod === "LABEL") {
    shippingLine = submission.labelFree
      ? "Verzendlabel via ArcanaFrisia – GRATIS (≥ €150)"
      : "Verzendlabel via ArcanaFrisia – €5,-";
  }

  const fullAddress = [
    submission.fullName || null,
    submission.addressLine1 || null,
    [submission.postalCode, submission.city].filter(Boolean).join(" "),
    submission.country || null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="mx-auto max-w-4xl p-6 text-slate-100">
      <div className="mb-4">
        <Link
          href="/admin/submissions"
          className="text-sm text-sky-400 underline"
        >
          ← Terug naar overzicht
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-1">
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

      {/* STATUS EDITOR */}
      <div className="mb-6">
        <StatusEditor
          id={submission.id}
          initialStatus={submission.status}
        />
      </div>

      {/* KLANTGEGEVENS */}
      <div className="mb-6 grid gap-4 md:grid-cols-2 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div>
          <h2 className="text-base font-semibold mb-2">
            Klantgegevens
          </h2>
          <div className="whitespace-pre-line text-sm text-slate-200">
            {fullAddress || "Geen adres ingevuld."}
          </div>
          <div className="mt-2 text-sm text-slate-300">
            <span className="font-semibold">E-mail: </span>
            {submission.email || "—"}
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div>
            <h3 className="font-semibold">Betaalmethode</h3>
            <p className="text-slate-300">{payoutLine}</p>
          </div>
          <div>
            <h3 className="font-semibold">Verzendwijze</h3>
            <p className="text-slate-300">{shippingLine}</p>
          </div>
          <div className="text-xs text-slate-500 mt-2">
            Extra meta: opgeslagen in <code>Submission.metaText</code>{" "}
            voor status-events.
          </div>
        </div>
      </div>

      {/* ITEMS TABEL */}
      <h2 className="text-lg font-semibold mb-2">Items</h2>
      <table className="min-w-full text-sm border border-slate-700 bg-slate-900/60">
        <thead className="bg-slate-800">
          <tr>
            <th className="text-left p-2">Kaart</th>
            <th className="text-right p-2">Qty</th>
            <th className="text-right p-2">Unit (€)</th>
            <th className="text-right p-2">Line (€)</th>
          </tr>
        </thead>
        <tbody>
          {enriched.map((row) => (
            <tr key={row.id} className="border-t border-slate-800">
              <td className="p-2 align-top">
                {row.label}
                <div className="text-xs text-slate-500">
                  #{row.cmId}
                </div>
              </td>
              <td className="p-2 text-right align-top">{row.qty}</td>
              <td className="p-2 text-right align-top">
                € {euro(row.unitCents)}
              </td>
              <td className="p-2 text-right align-top">
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
