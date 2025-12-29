export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import StatusEditor from "../StatusEditor"; // ⬅ vanuit parent-map
import ItemsEditor from "../ItemsEditor";


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
        set: meta?.set ?? "",
        name: meta?.name ?? "",
        collectorNumber: meta?.collectorNumber ?? "",
      };
    })

        .sort((a, b) => {
      const setA = (a.set || "").toUpperCase();
      const setB = (b.set || "").toUpperCase();
      if (setA < setB) return -1;
      if (setA > setB) return 1;

      const nameA = (a.name || "").toUpperCase();
      const nameB = (b.name || "").toUpperCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;

      const collA = (a.collectorNumber || "").toUpperCase();
      const collB = (b.collectorNumber || "").toUpperCase();
      if (collA < collB) return -1;
      if (collA > collB) return 1;

      return 0;
    });


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
  className="text-sm text-slate-200 visited:text-slate-200 underline decoration-[#C9A24E]/60 hover:text-[#C9A24E]"
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
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Items</h2>
<a
  href={`/api/admin/submissions/${submission.id}/csv`}
  className="inline-block text-xs px-3 py-1 rounded border border-slate-600 text-slate-200 visited:text-slate-200 hover:border-[#C9A24E] hover:text-[#C9A24E] hover:bg-slate-800 transition-colors underline decoration-[#C9A24E]/60"
>
  CSV export
</a>



      </div>

<ItemsEditor
  submissionId={submission.id}
  items={submission.items.map((item) => {
    const cmId = Number(item.productId);
    const meta = nameById.get(cmId);

    return {
      id: item.id,
      cmId,
      name: item.cardName || meta?.name || `#${cmId}`,
      set:
        (meta?.set as string | null) ??
        ((item.setCode as string | null) ?? null),
      collectorNumber:
        item.collectorNumber ||
        (meta?.collectorNumber as string | null) ||
        null,
      condition: (item.condition as string | null) ?? "NM",
      isFoil: item.isFoil,
      qty: item.qty,
      unitCents: Number(item.unitCents ?? 0),
      lineCents: Number(item.lineCents ?? 0),
    };
  })}
/>


    </div>
  );
}
