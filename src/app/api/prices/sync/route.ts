// src/app/api/prices/sync/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  try {
    // Admin UI post ruwe tekst uit textarea
    const text = await req.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    // Ondersteun array of object met .products
    const rows: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.products)
      ? parsed.products
      : [];

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, rows: 0 });
    }

    let ok = 0;
    for (const e of rows) {
      const productId = Number(e.idProduct ?? e.productId);
      if (!Number.isInteger(productId)) continue;

      const trend = num(e.trend);
      const trendFoil = num(e["trend-foil"] ?? e.trendFoil);

      await prisma.priceGuide.upsert({
        where: { productId },              // werkt nu omdat productId uniek is
        update: { trend, trendFoil, source: "Cardmarket", isCurrent: true },
        create: { productId, trend, trendFoil, source: "Cardmarket", isCurrent: true },
      });

      ok++;
    }

    return NextResponse.json({ ok: true, rows: ok });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
