// src/app/api/admin/submissions/[id]/csv/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

function csvEscape(value: unknown): string {
  const v = value == null ? "" : String(value);
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!submission) {
    return NextResponse.json(
      { ok: false, error: "Submission niet gevonden" },
      { status: 404 }
    );
  }

  // cardmarketIds uit productId (BigInt -> number)
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

  const metaById = new Map<
    number,
    { name: string; set: string | null; collectorNumber: string | null }
  >();

  for (const r of lookups) {
    metaById.set(r.cardmarketId as number, {
      name: r.name,
      set: r.set,
      collectorNumber: (r.collectorNumber as string | null) ?? null,
    });
  }

  // zelfde enrich + sort als in mail:
  type RowMeta = {
    item: (typeof submission.items)[number];
    meta?: { name: string; set: string | null; collectorNumber: string | null };
    cmId: number;
  };

  const enriched: RowMeta[] = submission.items.map((item) => {
    const cmId = Number(item.productId);
    const meta = metaById.get(cmId);
    return { item, meta, cmId };
  });

  // sorteren op set (asc) en dan naam (asc) => exact zoals mail
  enriched.sort((a, b) => {
    const setA = (a.meta?.set || "").toUpperCase();
    const setB = (b.meta?.set || "").toUpperCase();
    if (setA < setB) return -1;
    if (setA > setB) return 1;

    const nameA = (a.meta?.name || "").toUpperCase();
    const nameB = (b.meta?.name || "").toUpperCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;

    return 0;
  });

  const header = [
    "Line",
    "CardmarketId",
    "Label",
    "Set",
    "Name",
    "CollectorNumber",
    "Condition",
    "Foil",
    "Qty",
    "UnitCents",
    "LineCents",
    "UnitEuro",
    "LineEuro",
  ];

  const rows: string[][] = [header];

  enriched.forEach(({ item, meta, cmId }, idx) => {
    const cond = item.condition ?? "";
    const foilFlag = item.isFoil ? "Foil" : "";
    const qty = Number(item.qty ?? 0);
    const unitCents = Number(item.unitCents ?? 0);
    const lineCents = Number(item.lineCents ?? 0);
    const unitEuro = (unitCents / 100).toFixed(2);
    const lineEuro = (lineCents / 100).toFixed(2);

    const baseLabel = meta
      ? `${meta.name}${
          meta.set ? ` [${meta.set.toUpperCase()}]` : ""
        }${meta.collectorNumber ? ` #${meta.collectorNumber}` : ""}`
      : `#${cmId}`;

    const details: string[] = [];
    if (cond) details.push(String(cond));
    if (item.isFoil) details.push("Foil");
    const suffix = details.length ? ` • ${details.join(" • ")}` : "";
    const label = `${baseLabel}${suffix}`;

    rows.push([
      String(idx + 1),
      cmId ? String(cmId) : "",
      label,
      meta?.set ?? "",
      meta?.name ?? "",
      meta?.collectorNumber ?? "",
      cond,
      foilFlag,
      String(qty),
      String(unitCents),
      String(lineCents),
      unitEuro,
      lineEuro,
    ]);
  });

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="submission-${id}.csv"`,
    },
  });
}
