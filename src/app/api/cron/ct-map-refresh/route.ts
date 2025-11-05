import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit  = Math.min(Number(searchParams.get("limit") ?? "100"), 500);
  const cursor = Number(searchParams.get("cursor") ?? "0");
  const start = Date.now();

  // Zoek alleen onvolledige mappings
  const batch = await prisma.blueprintMapping.findMany({
    where: {
      OR: [
        { cardmarketId: null },
        { setCode: null },
        { collectorNumber: null },
        { foil: null }
      ]
    },
    orderBy: { blueprintId: "asc" },
    take: limit,
    skip: cursor
  });

  // Niks externs (geen CT-calls): we triggeren enkel de backfill op basis van Scryfall
  if (batch.length > 0) {
    // roep de backfill aan (die jouw twee UPDATEs draait)
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    try {
      await fetch(`${base}/api/maintenance/mapping/backfill-a`, { method: "POST" });
    } catch (_) { /* negeren; draait volgende batch weer */ }
  }

  return NextResponse.json({
    status: "ok",
    processed: batch.length,
    cursor,
    nextCursor: cursor + batch.length,
    durationMs: Date.now() - start
  });
}
