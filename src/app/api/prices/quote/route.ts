export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const DEFAULT_PCT = 60;        // %
const MIN_PAYOUT_EUR = 0.05;   // floor
const MAX_PAYOUT_EUR = 250;    // cap

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const pctParam = Number(url.searchParams.get("pct") ?? DEFAULT_PCT);
    const pct = Number.isFinite(pctParam) && pctParam > 0 ? pctParam : DEFAULT_PCT;

    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ ok: true, pct, quotes: [] });
    }

    // Collect requested product IDs (client sends idProduct)
   // ✅ Maak veilig een number[] met productIds uit body.items
const ids: number[] = Array.from(
  new Set(
    (Array.isArray(items) ? items : [])
      .map((i: any) =>
        typeof i?.idProduct === "number" || typeof i?.idProduct === "string"
          ? Number(i.idProduct)
          : NaN
      )
      .filter((n) => Number.isFinite(n))
  )
);

if (ids.length === 0) {
  // niks te doen (houd dezelfde shape aan als je huidige response)
  return NextResponse.json({ ok: true, guides: [] });
}


if (ids.length === 0) {
  return NextResponse.json({ ok: true, guides: [] }); // niets te doen
}


    // Fetch guides by productId (DB column)
    const guides = await prisma.priceGuide.findMany({
      where: { productId: { in: ids }, isCurrent: true },
    });

    // Map by productId for fast lookup
    const byId = new Map<number, (typeof guides)[number]>();
    for (const g of guides) byId.set(g.productId as number, g);

    const factor = pct / 100;

    const quotes = items.map((raw: any) => {
      const idProduct = Number(raw.idProduct);
      const isFoil = Boolean(raw.isFoil);
      const g = byId.get(idProduct);

      const base = Number(g?.trend ?? 0);
      const foilSpecific = g?.trendFoil == null ? null : Number(g.trendFoil);
      const trend = isFoil ? (foilSpecific ?? base) : base;

      let unit = round2(trend * factor);
      if (unit < MIN_PAYOUT_EUR) unit = 0;
      if (unit > MAX_PAYOUT_EUR) unit = MAX_PAYOUT_EUR;

      const available = !!g && trend > 0 && unit >= MIN_PAYOUT_EUR;
      return { idProduct, isFoil, unit, available };
    });

    return NextResponse.json({ ok: true, pct, quotes });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
