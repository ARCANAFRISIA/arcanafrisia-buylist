export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const items: Array<{ idProduct: number | string; isFoil: boolean; qty?: number }> =
      Array.isArray(body?.items) ? body.items : [];

    if (items.length === 0) {
      return NextResponse.json({ ok: true, quotes: [] });
    }

    // Unieke productIds als number[]
    const ids = Array.from(
      new Set(
        items
          .map((i) =>
            typeof i?.idProduct === "number" || typeof i?.idProduct === "string"
              ? Number(i.idProduct)
              : NaN
          )
          .filter((n) => Number.isFinite(n))
      )
    ) as number[];

    if (ids.length === 0) {
      return NextResponse.json({ ok: true, quotes: [] });
    }

    // Haal RAW trends (EUR) op — GEEN korting hier toepassen
    const guides = await prisma.priceGuide.findMany({
      where: { productId: { in: ids }, isCurrent: true },
      select: { productId: true, trend: true, trendFoil: true },
    });

    const byId = new Map<number, { trend: number | null; trendFoil: number | null }>();
    for (const g of guides) byId.set(g.productId as number, { trend: g.trend, trendFoil: g.trendFoil });

    const quotes = items.map((raw) => {
      const idProduct = Number(raw.idProduct);
      const isFoil = Boolean(raw.isFoil);
      const rec = byId.get(idProduct);

      const base = Number(rec?.trend ?? 0); // non-foil
      const foil = rec?.trendFoil == null ? null : Number(rec.trendFoil);
      const trend = isFoil ? (foil ?? base) : base;

      const unit = Number.isFinite(trend) ? round2(trend) : 0; // RAW trend in EUR
      const available = !!rec && unit > 0;

      return { idProduct, isFoil, unit, available };
    });

    return NextResponse.json({ ok: true, quotes });
  } catch (e: any) {
    console.error("quote error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal error" }, { status: 500 });
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
