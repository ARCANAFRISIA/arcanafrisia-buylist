// src/app/api/prices/trending/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPendingQtyByCardmarketId } from "@/lib/buylistPending";

const EXCLUDED_SET_CODES = ["lea", "leb", "ced", "cei"]; // AB + Collectors Editions

// Constructed chain zonder overlap
const CONSTRUCTED_CHAIN = ["standard", "pioneer", "modern", "legacy", "vintage"] as const;
type ChainFormat = (typeof CONSTRUCTED_CHAIN)[number];

type CommanderFormat = "commander";
type ExtraFormat = "premodern" | "pauper";


type Item = {
  id: string;
  name: string;
  set: string;
  imageSmall?: string | null;
  imageNormal?: string | null;
  cardmarketId?: number | null;
  trend: number | null;
  trendFoil: number | null;
  rarity?: string | null;
  collectorNumber?: string | null;

  ownQtyOnHand: number;
  qtyPending: number;
  ownQty: number;

  maxBuy: number | null;
  tix: number | null;
  edhrecRank: number | null;
  gameChanger: boolean;
};

function decToNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Legalities helper – vangt zowel {duel:...} als {set:{duel:...}} af
function isLegal(legalities: any, format: string): boolean {
  if (!legalities) return false;
  const base = legalities.set ?? legalities;
  const val = base?.[format];
  return val === "legal";
}

export async function GET(_req: Request) {
  // 1) basis-pool uit ScryfallLookup (top N op TIX)
  const rows = await prisma.scryfallLookup.findMany({
    where: {
      tix: { not: null, gt: 0 },
      set: { notIn: EXCLUDED_SET_CODES },
    },
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
      legalities: true,
    },
    orderBy: { tix: "desc" },
    take: 500,
  });

  if (!rows.length) {
    return NextResponse.json({ formats: {} });
  }

  // 2) CM trends en eigen voorraad ophalen (zoals in search)
  const ids = rows
    .map((r) => r.cardmarketId)
    .filter((id): id is number => id != null);

  const guides = ids.length
    ? await prisma.cMPriceGuide.findMany({
        where: { cardmarketId: { in: ids } },
        select: { cardmarketId: true, trend: true, foilTrend: true },
      })
    : [];

  const byId = new Map<number, { trend: number | null; trendFoil: number | null }>();
  for (const g of guides) {
    byId.set(g.cardmarketId as number, {
      trend: decToNum(g.trend),
      trendFoil: decToNum(g.foilTrend),
    });
  }

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

  const pendingById = ids.length
    ? await getPendingQtyByCardmarketId(ids)
    : new Map<number, number>();

  // 3) Item-shape opbouwen per scryfallId
  const itemsByScryfallId = new Map<string, Item>();

  for (const r of rows) {
    const cmId = r.cardmarketId ?? null;
    const meta = cmId != null ? byId.get(cmId) : undefined;
    const ownOnHand = cmId != null ? ownOnHandById.get(cmId) ?? 0 : 0;
    const qtyPending = cmId != null ? pendingById.get(cmId) ?? 0 : 0;
    const ownQtyTotal = ownOnHand + qtyPending;

    let maxBuy: number | null = null;
    const baseTrend = meta?.trend ?? null;
    if (cmId != null && baseTrend != null && baseTrend > 0) {
      const baseCap = baseTrend >= 100 ? 4 : 8;
      maxBuy = Math.max(baseCap - ownQtyTotal, 0);
    }

    if (!r.scryfallId) continue;

    itemsByScryfallId.set(r.scryfallId, {
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

      ownQtyOnHand: ownOnHand,
      qtyPending,
      ownQty: ownQtyTotal,

      maxBuy,
      tix: decToNum(r.tix),
      edhrecRank: r.edhrecRank ?? null,
      gameChanger: r.gameChanger ?? false,
    });
  }

  // 4) Constructed chain zonder overlap: Standard → Pioneer → Modern → Legacy → Vintage
  const used = new Set<string>();

  const formats: Record<string, Item[]> = {};

  for (const format of CONSTRUCTED_CHAIN) {
    const picked: Item[] = [];

    for (const r of rows) {
      if (picked.length >= 20) break;
      if (!r.scryfallId) continue;
      if (used.has(r.scryfallId)) continue;

      const legal = isLegal(r.legalities, format);
      if (!legal) continue;

      const item = itemsByScryfallId.get(r.scryfallId);
      if (!item) continue;

      // Voor constructed willen we wel een TIX-waarde hebben
      if (!item.tix || item.tix <= 0) continue;

      picked.push(item);
      used.add(r.scryfallId);
    }

    formats[format] = picked;
  }

  // 4b) Extra constructed formats: Premodern & Pauper (los van de chain, mogen overlappen)
  const extraFormats: ExtraFormat[] = ["premodern", "pauper"];

  for (const format of extraFormats) {
    const picked: Item[] = [];

    for (const r of rows) {
      if (picked.length >= 20) break;
      if (!r.scryfallId) continue;

      const legal = isLegal(r.legalities, format);
      if (!legal) continue;

      const item = itemsByScryfallId.get(r.scryfallId);
      if (!item) continue;
      if (!item.tix || item.tix <= 0) continue;

      picked.push(item);
    }

    // sorteer nog even extra op TIX desc, voor het geval de input volgorde ooit anders is
    picked.sort((a, b) => (b.tix ?? 0) - (a.tix ?? 0));

    formats[format] = picked.slice(0, 20);
  }


  // 5) Commander – aparte ranking op EDHREC
  const commanderCandidates = rows.filter((r) => {
    const item = r.scryfallId ? itemsByScryfallId.get(r.scryfallId) : null;
    if (!item) return false;
    if (!isLegal(r.legalities, "commander")) return false;
    if (item.edhrecRank == null) return false;
    return true;
  });

  commanderCandidates.sort((a, b) => {
    const ia = a.scryfallId ? itemsByScryfallId.get(a.scryfallId) : null;
    const ib = b.scryfallId ? itemsByScryfallId.get(b.scryfallId) : null;
    const ra = ia?.edhrecRank ?? 999999;
    const rb = ib?.edhrecRank ?? 999999;
    if (ra !== rb) return ra - rb; // lage rank eerst
    const ta = ia?.tix ?? 0;
    const tb = ib?.tix ?? 0;
    return tb - ta; // dan op TIX
  });

  const commanderItems: Item[] = [];
  for (const r of commanderCandidates) {
    if (commanderItems.length >= 20) break;
    if (!r.scryfallId) continue;
    const item = itemsByScryfallId.get(r.scryfallId);
    if (!item) continue;
    commanderItems.push(item);
  }

  formats["commander"] = commanderItems;

  return NextResponse.json({ formats });
}
