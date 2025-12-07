// src/app/api/prices/search/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPendingQtyByCardmarketId } from "@/lib/buylistPending";


const norm = (s: string) => s.trim().replace(/\s+/g, " ");

function decToNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = norm(searchParams.get("query") ?? "");
  if (q.length < 2) return NextResponse.json({ items: [] });

  // 1) basisgegevens uit scryfallLookup (incl. edhrec/tix/gameChanger)
  const rows = await prisma.scryfallLookup.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    select: {
      cardmarketId: true,
      scryfallId: true,
      name: true,
      set: true,
      imageSmall: true,
      imageNormal: true,
      rarity: true,
      tix: true,
      edhrecRank: true,
      gameChanger: true,
      collectorNumber: true,
    },
    take: 100, // was eerder 20; wat ruimer is prima
  });

  // 2) cardmarketIds verzamelen
  const ids = rows
    .map((r) => r.cardmarketId)
    .filter((id): id is number => id != null);

  // 3) trends bij die cardmarketIds ophalen uit CMPriceGuide
  const guides = ids.length
    ? await prisma.cMPriceGuide.findMany({
        where: { cardmarketId: { in: ids } },
        select: { cardmarketId: true, trend: true, foilTrend: true },
      })
    : [];

  const byId = new Map<
    number,
    { trend: number | null; trendFoil: number | null }
  >();
  for (const g of guides) {
    byId.set(g.cardmarketId as number, {
      trend: decToNum(g.trend),
      trendFoil: decToNum(g.foilTrend),
    });
  }

    // 4) eigen voorraad per cardmarketId ophalen
    let ownOnHandById = new Map<number, number>();
  if (ids.length) {
    const inv = await prisma.inventoryBalance.groupBy({
      where: { cardmarketId: { in: ids } },
      by: ["cardmarketId"],
      _sum: { qtyOnHand: true },
    });

    ownOnHandById = new Map(
      inv.map((row) => [
        row.cardmarketId as number,
        row._sum.qtyOnHand ?? 0,
      ])
    );
  }



  // 4b) pending buylist-qty per cardmarketId ophalen
  const pendingById = ids.length
    ? await getPendingQtyByCardmarketId(ids)
    : new Map<number, number>();


  console.log("SEARCH PENDING DEBUG", {
    ids,
    pendingEntries: Array.from(pendingById.entries()).slice(0, 10),
  });



  // 5) response opbouwen – client rekent zelf payout met de engine
  const items = rows.map((r) => {
    const cmId = r.cardmarketId ?? null;
    const meta = cmId != null ? byId.get(cmId) : undefined;
        const ownOnHand = cmId != null ? ownOnHandById.get(cmId) ?? 0 : 0;
    const qtyPending = cmId != null ? pendingById.get(cmId) ?? 0 : 0;
    const ownQtyTotal = ownOnHand + qtyPending;

    let maxBuy: number | null = null;
    const baseTrend = meta?.trend ?? null;
    if (cmId != null && baseTrend != null && baseTrend > 0) {
      const baseCap = baseTrend >= 100 ? 4 : 8; // dure kaarten lagere cap
      maxBuy = Math.max(baseCap - ownQtyTotal, 0);
    }

    return {
      id: r.scryfallId,
      name: r.name,
      set: r.set,
      imageSmall: r.imageSmall,
      imageNormal: r.imageNormal,
      cardmarketId: cmId,
      trend: meta?.trend ?? null,
      trendFoil: meta?.trendFoil ?? null,
      rarity: r.rarity,
      collectorNumber: r.collectorNumber,

      // nieuw:
      ownQtyOnHand: ownOnHand,
      qtyPending,
      ownQty: ownQtyTotal,

      maxBuy,
      tix: decToNum(r.tix),
      edhrecRank: r.edhrecRank,
      gameChanger: r.gameChanger ?? false,
    };

  });

  return NextResponse.json({ items });
}
