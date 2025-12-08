// src/app/api/prices/search/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPendingQtyByCardmarketId } from "@/lib/buylistPending";
import { Prisma } from "@prisma/client";

const EXCLUDED_SET_CODES = ["lea", "leb", "ced", "cei", "sum", "4bb"]; // Alpha, Beta, Unlimited in lowercase

// Recente Standard-sets (kun je later uitbreiden/aanpassen)
const CURRENT_STANDARD_SETS = [
  "fdn", // Foundations
  "woe", // Wilds of Eldraine
  "lci", // The Lost Caverns of Ixalan
  "mkm", // Murders at Karlov Manor
  "otj", // Outlaws of Thunder Junction
  "big", // The Big Score
  "blb", // Bloomburrow
  "dsk", // Duskmourn: House of Horror
  "dft", // Aetherdrift
  "tdm", // Tarkir: Dragonstorm
  "fin", // Final Fantasy
  "eoe", // Edge of Eternities
  "spm", // Marvel's Spider-Man
  "tla", // Avatar: The Last Airbender
];

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

function decToNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const rawQ = searchParams.get("query") ?? "";
  const q = norm(rawQ);

  const setParam = (searchParams.get("set") ?? "").toLowerCase();
  const rarityParam = (searchParams.get("rarity") ?? "").toLowerCase();
  const formatParam = (searchParams.get("format") ?? "").toLowerCase();

  // ------- WHERE opbouwen -------
  const where: Prisma.ScryfallLookupWhereInput = {};

  // SET-filter
  if (setParam) {
    // expliciet gekozen set
    where.set = setParam;
  } else if (formatParam === "standard") {
    // geen set gekozen, maar wel format = standard -> beperk tot recente Standard-sets
    where.set = { in: CURRENT_STANDARD_SETS };
  } else {
    // generieke fallback
    where.set = { notIn: EXCLUDED_SET_CODES };
  }

  // naam is optioneel – alleen filteren als er 2+ letters zijn
  if (q.length >= 2) {
    where.name = { contains: q, mode: "insensitive" };
  }

  // rarity-filter (gaat pas werken zodra jouw ETL rarity vult)
  if (rarityParam) {
    where.rarity = rarityParam;
  }

  // format-filter op basis van jouw legalities-structuur:
  // legalities = { set: { standard: "legal", modern: "legal", ... } }
  if (formatParam) {
    (where as any).legalities = {
      path: ["set", formatParam],
      equals: "legal",
    };
  }

  // gebruik je een filter? (dan wat ruimer ophalen)
  const hasFilter =
    !!setParam || !!rarityParam || !!formatParam || q.length >= 2;

  // basis: 100, maar als gebruiker actief filtert → 500
  const take = hasFilter ? 500 : 100;

  // ------- standaard ORDER BY logica -------
  let orderBy:
    | Prisma.ScryfallLookupOrderByWithRelationInput
    | Prisma.ScryfallLookupOrderByWithRelationInput[];

  if (formatParam === "standard" && !setParam && !q) {
    // Standard overview: populaire kaarten eerst
    orderBy = [
      { tix: "desc" },          // eerst hoogste TIX
      { edhrecRank: "asc" },    // dan beste EDHREC rank
      { cardmarketId: "asc" },  // stabiele tie-breaker
    ];
  } else {
    // andere views: stabiel op cardmarketId
    orderBy = { cardmarketId: "asc" };
  }

  // ------- 1) basisgegevens ophalen -------
  const rows = await prisma.scryfallLookup.findMany({
    where,
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
    orderBy,
    take,
  });

  // ------- 2) cardmarketIds verzamelen -------
  const ids = rows
    .map((r) => r.cardmarketId)
    .filter((id): id is number => id != null);

  // ------- 3) trends bij die cardmarketIds -------
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

  // ------- 4) eigen voorraad per cardmarketId -------
  let ownOnHandById = new Map<number, number>();
  if (ids.length) {
    const inv = await prisma.inventoryBalance.groupBy({
      where: { cardmarketId: { in: ids } },
      by: ["cardmarketId"],
      _sum: { qtyOnHand: true },
    });

    ownOnHandById = new Map(
      inv.map((row) => [row.cardmarketId as number, row._sum.qtyOnHand ?? 0])
    );
  }

  // ------- 4b) pending buylist-qty -------
  const pendingById = ids.length
    ? await getPendingQtyByCardmarketId(ids)
    : new Map<number, number>();

  console.log("SEARCH PENDING DEBUG", {
    ids,
    pendingEntries: Array.from(pendingById.entries()).slice(0, 10),
  });

  // ------- 5) response opbouwen -------
  const items = rows.map((r) => {
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

      ownQtyOnHand: ownOnHand,
      qtyPending,
      ownQty: ownQtyTotal,

      maxBuy,
      tix: decToNum(r.tix),
      edhrecRank: r.edhrecRank,
      gameChanger: r.gameChanger ?? false,
      legalities: (r as any).legalities ?? null,
    };
  });

  return NextResponse.json({ items });
}
