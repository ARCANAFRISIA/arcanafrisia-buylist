export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  MTGO_COMMANDER_WORKSHOP_ALIASES,
  MTGO_COMMANDER_WORKSHOP_NAMES,
} from "@/lib/mtgoCommanderWorkshopNames";

type LookupRow = {
  cardmarketId: number;
  tcgplayerId: number | null;
  scryfallId: string;
  oracleId: string | null;
  name: string;
  set: string;
  collectorNumber: string | null;
  lang: string | null;
  imageSmall: string | null;
  imageNormal: string | null;
  rarity: string | null;
  usd: number | null;
  eur: number | null;
  tix: number | null;
  edhrecRank: number | null;
  gameChanger: boolean | null;
  updatedAt: Date;
};

type PriceRow = {
  cardmarketId: number;
  trend: number | null;
  foilTrend: number | null;
  updatedAt: Date;
};

function uniquePreserveOrder(names: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const rawName of names) {
    const inputName = rawName.trim();
    if (!inputName) continue;

    const key = inputName.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(inputName);
  }

  return out;
}

function canonicalName(inputName: string) {
  return MTGO_COMMANDER_WORKSHOP_ALIASES[inputName] ?? inputName;
}

function positiveNumber(value: number | null | undefined) {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return value;
}

function sortCandidates(
  a: LookupRow,
  b: LookupRow,
  priceById: Map<number, PriceRow>
) {
  const aTrend = positiveNumber(priceById.get(a.cardmarketId)?.trend);
  const bTrend = positiveNumber(priceById.get(b.cardmarketId)?.trend);

  // 1. Prefer rows with a positive nonfoil trend.
  if (aTrend !== null && bTrend === null) return -1;
  if (aTrend === null && bTrend !== null) return 1;

  // 2. Then cheapest positive nonfoil trend.
  if (aTrend !== null && bTrend !== null && aTrend !== bTrend) {
    return aTrend - bTrend;
  }

  // 3. Then best EDHREC rank.
  const aEdh = a.edhrecRank ?? Number.MAX_SAFE_INTEGER;
  const bEdh = b.edhrecRank ?? Number.MAX_SAFE_INTEGER;
  if (aEdh !== bEdh) return aEdh - bEdh;

  // 4. Prefer image.
  if (a.imageSmall && !b.imageSmall) return -1;
  if (!a.imageSmall && b.imageSmall) return 1;

  // 5. Stable fallback.
  return a.cardmarketId - b.cardmarketId;
}

export async function GET() {
  try {
    const inputNames = uniquePreserveOrder(MTGO_COMMANDER_WORKSHOP_NAMES);

    const canonicalNames = uniquePreserveOrder(
      inputNames.map((name) => canonicalName(name))
    );

    const lookups = await prisma.scryfallLookup.findMany({
      where: {
        name: {
          in: canonicalNames,
        },
      },
      select: {
        cardmarketId: true,
        tcgplayerId: true,
        scryfallId: true,
        oracleId: true,
        name: true,
        set: true,
        collectorNumber: true,
        lang: true,
        imageSmall: true,
        imageNormal: true,
        rarity: true,
        usd: true,
        eur: true,
        tix: true,
        edhrecRank: true,
        gameChanger: true,
        updatedAt: true,
      },
    });

    const allCandidateCardmarketIds = lookups.map((row) => row.cardmarketId);

    const priceRows =
      allCandidateCardmarketIds.length > 0
        ? await prisma.cMPriceGuide.findMany({
            where: {
              cardmarketId: {
                in: allCandidateCardmarketIds,
              },
            },
            select: {
              cardmarketId: true,
              trend: true,
              foilTrend: true,
              updatedAt: true,
            },
          })
        : [];

    const priceById = new Map<number, PriceRow>();
    for (const row of priceRows) {
      priceById.set(row.cardmarketId, row);
    }

    const rowsByName = new Map<string, LookupRow[]>();

    for (const row of lookups) {
      const key = row.name.toLowerCase();
      const arr = rowsByName.get(key) ?? [];
      arr.push(row);
      rowsByName.set(key, arr);
    }

    // Own stock wordt bewust per NAAM berekend over alle printings.
    // Dus set/cardmarketId maakt hier niet uit.
    const balanceRows =
      allCandidateCardmarketIds.length > 0
        ? await prisma.inventoryBalance.groupBy({
            by: ["cardmarketId"],
            where: {
              cardmarketId: {
                in: allCandidateCardmarketIds,
              },
            },
            _sum: {
              qtyOnHand: true,
            },
          })
        : [];

    const stockQtyByCardmarketId = new Map<number, number>();
    for (const row of balanceRows) {
      stockQtyByCardmarketId.set(
        row.cardmarketId,
        Number(row._sum.qtyOnHand ?? 0)
      );
    }

    const ownStockQtyByCanonicalName = new Map<string, number>();

    for (const lookup of lookups) {
      const key = lookup.name.toLowerCase();
      const current = ownStockQtyByCanonicalName.get(key) ?? 0;
      const qty = stockQtyByCardmarketId.get(lookup.cardmarketId) ?? 0;
      ownStockQtyByCanonicalName.set(key, current + qty);
    }

    const rows = inputNames.map((inputName, index) => {
      const matchedName = canonicalName(inputName);
      const candidates = rowsByName.get(matchedName.toLowerCase()) ?? [];
      const ownStockQty =
        ownStockQtyByCanonicalName.get(matchedName.toLowerCase()) ?? 0;

      if (candidates.length === 0) {
        return {
          index: index + 1,
          inputName,
          matchedName,
          matched: false,
          cardmarketId: null,
          tcgplayerId: null,
          scryfallId: null,
          oracleId: null,
          name: inputName,
          set: null,
          collectorNumber: null,
          lang: null,
          imageSmall: null,
          imageNormal: null,
          rarity: null,
          usd: null,
          eur: null,
          tix: null,
          edhrecRank: null,
          gameChanger: false,
          trendPriceEur: null,
          foilTrendPriceEur: null,
          priceUpdatedAt: null,
          scryfallUpdatedAt: null,
          printCount: 0,
          minTrendPriceEur: null,
          maxTrendPriceEur: null,
          ownStockQty: 0,
          ownStock: false,
        };
      }

      const sorted = [...candidates].sort((a, b) =>
        sortCandidates(a, b, priceById)
      );

      const best = sorted[0];
      const price = priceById.get(best.cardmarketId);

      const trendValues = candidates
        .map((candidate) =>
          positiveNumber(priceById.get(candidate.cardmarketId)?.trend)
        )
        .filter((value): value is number => value !== null);

      const minTrendPriceEur =
        trendValues.length > 0 ? Math.min(...trendValues) : null;

      const maxTrendPriceEur =
        trendValues.length > 0 ? Math.max(...trendValues) : null;

      return {
        index: index + 1,
        inputName,
        matchedName,
        matched: true,
        cardmarketId: best.cardmarketId,
        tcgplayerId: best.tcgplayerId,
        scryfallId: best.scryfallId,
        oracleId: best.oracleId,
        name: best.name,
        set: best.set,
        collectorNumber: best.collectorNumber,
        lang: best.lang,
        imageSmall: best.imageSmall,
        imageNormal: best.imageNormal,
        rarity: best.rarity,
        usd: best.usd,
        eur: best.eur,
        tix: best.tix,
        edhrecRank: best.edhrecRank,
        gameChanger: Boolean(best.gameChanger),
        trendPriceEur: price?.trend ?? null,
        foilTrendPriceEur: price?.foilTrend ?? null,
        priceUpdatedAt: price?.updatedAt ?? null,
        scryfallUpdatedAt: best.updatedAt,
        printCount: candidates.length,
        minTrendPriceEur,
        maxTrendPriceEur,
        ownStockQty,
        ownStock: ownStockQty > 0,
      };
    });

    const matched = rows.filter((row) => row.matched).length;
    const unmatched = rows.length - matched;
    const owned = rows.filter((row) => row.ownStockQty > 0).length;
    const missingOwnStock = rows.filter(
      (row) => row.matched && row.ownStockQty <= 0
    ).length;

    return NextResponse.json({
      ok: true,
      count: rows.length,
      matched,
      unmatched,
      owned,
      missingOwnStock,
      rows,
    });
  } catch (err) {
    console.error("admin/name-list error", err);

    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}