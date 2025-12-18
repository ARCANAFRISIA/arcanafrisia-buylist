// src/app/api/tools/wants/format/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getPendingQtyByCardmarketId } from "@/lib/buylistPending";

// ------------------ SET-GROEPEN ------------------
// Zelfde codes als in je /prices/search route
const EXCLUDED_SET_CODES = ["lea", "leb", "ced", "cei", "sum", "4bb"];

const CURRENT_STANDARD_SETS = [
  "fdn","woe","lci","mkm","otj","big","blb","dsk","dft","tdm","fin","eoe","spm","tla",
];

const CURRENT_PIONEER_SETS = [
  "aer","afr","akh","bfz","bng","bro","brr","dar","dgm","dmu","dtk","eld","emn","frf",
  "grn","gtc","hou","iko","jou","khm","kld","ktk","m14","m15","m19","m20","m21","mat",
  "mid","moc","mom","neo","ogw","one","ori","rix","rna","rtr","snc","soi","stx","thb",
  "ths","vow","war","xln","znr",
];

const CURRENT_MODERN_SETS = [
  "mh3","mh2","mh1","ltr","acr","mm3","mm2","mma","ddj","v12","m13","pc2","avr","hel",
  "ddi","dka","pd3","isd","ddh","v11","m12","td2","nph","ddg","mbs","lgc","som","ddf",
  "v10","m11","dpa","roe","dde","wwk","h09","ddd","zen","m10","arb","ddc","url","con",
  "dtp","dd2","ala","drb","eve","shm","mor","dd1","lrw","10e","fut","plc","tsp","tsb",
  "csp","dis","gpt","rav","sal","9ed","sok","bok","chk","5dn","dst","mrd","8ed",
];

const CURRENT_COMMANDER_SETS = [
  "c13","c14","c15","c16","c17","c18","c19","c20","c21","eoc","fic","tdc","drc","dsc",
  "blc","m3c","otc","mkc","llc","woc","cmm","ltc","moc","onc","scd","brc","bot","brr",
  "40k","dmc","clb","snc","nec","voc","mic","cc2","afc","khc","zrc","cc1","cmr","cm2",
  "cma","j22","jmp","j25","bbd","rex","pip","clu",
];

const CURRENT_LEGACY_SETS = [
  "scg","lgn","ons","tor","ody","apc","7ed","pls","inv","btd","pcy","nem","brb","mmq",
  "uds","ptk","6ed","ulg","ath","usg","ugl","p02","exo","sth","tmp","wth","por","5ed",
  "vis","mir","all","hml","ren","chr","ice","4ed","fem","drk","leg","3ed","fbb","atq",
  "arn","2ed",
];

const CURRENT_SPECIALS_SETS = [
  "znl","spg","unf","ugl","unh","und","ust","mb1","mb2","lst","sld","slc",
];

// kleine helper
const toNum = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ------------------ CT helper ------------------
type CtRow = {
  cardmarketId: number | null;
  bucket: string | null;
  isFoil: boolean | null;
  minPrice: any;
};

function chooseCtMinPrice(
  setCode: string,
  rows: CtRow[] | undefined
): number | null {
  if (!rows || !rows.length) return null;
  const set = setCode.toLowerCase();

  // jongere sets → liever NM, oudere → liever EX
  const modernish =
    CURRENT_STANDARD_SETS.includes(set) ||
    CURRENT_PIONEER_SETS.includes(set) ||
    CURRENT_MODERN_SETS.includes(set);

  const prefBuckets = modernish ? ["NM", "EX", "GD"] : ["EX", "GD", "NM"];

  for (const b of prefBuckets) {
    const hit = rows.find(
      (r) =>
        (r.bucket ?? "").toUpperCase() === b &&
        (r.isFoil === false || r.isFoil == null)
    );
    const val = hit ? toNum(hit.minPrice) : null;
    if (val && val > 0) return val;
  }
  return null;
}

// ------------------ hoofdhandler ------------------
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const format = (url.searchParams.get("format") ?? "commander").toLowerCase();

    // parameters / defaults
    const maxItems = Number(url.searchParams.get("maxItems") ?? "150");
    const minTix = Number(url.searchParams.get("minTix") ?? (format === "standard" ? "3" : "5"));
    const minTrend = Number(url.searchParams.get("minTrend") ?? "1");
    const maxTrend = Number(url.searchParams.get("maxTrend") ?? "100");
    // alleen voor arbitrage:
    const minMarginPct = Number(url.searchParams.get("minMarginPct") ?? "0.3"); // 30%
    const minAbsMargin = Number(url.searchParams.get("minAbsMargin") ?? "2");   // €2

    // ---------- 1) basis query op ScryfallLookup ----------
   const where: Prisma.ScryfallLookupWhereInput = {
  // cardmarketId is bij jou non-nullable, dus geen "not: null" gebruiken
  set: { notIn: EXCLUDED_SET_CODES },
  // tix filteren we liever op > 0 dan op not null
  // (en extra filtering doen we later in JS)
  tix: { gt: 0 },
};


    if (format === "standard") {
      where.set = { in: CURRENT_STANDARD_SETS };
    } else if (format === "pioneer") {
      where.set = { in: CURRENT_PIONEER_SETS };
    } else if (format === "modern") {
      where.set = { in: CURRENT_MODERN_SETS };
    } else if (format === "legacy") {
      where.set = { in: CURRENT_LEGACY_SETS };
    } else if (format === "commander") {
      where.set = { in: CURRENT_COMMANDER_SETS };
    } else if (format === "arbitrage") {
      // arbitrage: alle sets behalve excluded -> already set in where
    }

    const baseOrder: Prisma.ScryfallLookupOrderByWithRelationInput[] = [
      { tix: "desc" },
      { edhrecRank: "asc" },
      { cardmarketId: "desc" },
    ];

    // veel ruimte pakken zodat we na filters nog 150 overhouden
    const scryRows = await prisma.scryfallLookup.findMany({
      where,
      select: {
        cardmarketId: true,
        scryfallId: true,
        name: true,
        set: true,
        collectorNumber: true,
        rarity: true,
        eur: true,
        tix: true,
        edhrecRank: true,
        gameChanger: true,
      },
      orderBy: baseOrder,
      take: 1500,
    });

    const ids = scryRows
      .map((r) => r.cardmarketId)
      .filter((id): id is number => id != null);

    if (!ids.length) {
      return NextResponse.json({
        ok: true,
        format,
        items: [],
        reason: "no cardmarketIds found for this selection",
      });
    }

    // ---------- 2) prijsdata ophalen ----------
    const cmGuides = await prisma.cMPriceGuide.findMany({
      where: { cardmarketId: { in: ids } },
      select: {
        cardmarketId: true,
        trend: true,
        foilTrend: true,
      },
    });

    const byGuide = new Map<
      number,
      { trend: number | null; foilTrend: number | null }
    >();
    for (const g of cmGuides) {
      byGuide.set(g.cardmarketId as number, {
        trend: toNum(g.trend),
        foilTrend: toNum(g.foilTrend),
      });
    }

    const ctRows = await prisma.cTMarketLatest.findMany({
      where: { cardmarketId: { in: ids } },
      select: {
        cardmarketId: true,
        bucket: true,
        isFoil: true,
        minPrice: true,
      },
    });

    const byCt = new Map<number, CtRow[]>();
    for (const r of ctRows) {
      const cmId = r.cardmarketId as number;
      const arr = byCt.get(cmId) ?? [];
      arr.push(r as CtRow);
      byCt.set(cmId, arr);
    }

    // eigen voorraad
    const inv = await prisma.inventoryBalance.groupBy({
      where: { cardmarketId: { in: ids } },
      by: ["cardmarketId"],
      _sum: { qtyOnHand: true },
    });
    const ownById = new Map<number, number>(
      inv.map((row) => [row.cardmarketId as number, row._sum.qtyOnHand ?? 0])
    );

    const pendingById = await getPendingQtyByCardmarketId(ids);

    // ---------- 3) candidates bouwen ----------
    type Candidate = {
      cardmarketId: number;
      scryfallId: string;
      name: string;
      set: string;
      collectorNumber: string | null;
      rarity: string | null;
      tix: number | null;
      edhrecRank: number | null;
      gameChanger: boolean;
      trend: number;
      foilTrend: number | null;
      ctMinPrice: number | null;
      ownQty: number;
      ownOnHand: number;
      qtyPending: number;
      maxBuy: number;
      wishPrice: number;
      marginPct?: number;
      marginAbs?: number;
    };

    const candidates: Candidate[] = [];

    for (const r of scryRows) {
      const cmId = r.cardmarketId!;
      const tix = toNum(r.tix);
      if (tix == null || tix < minTix) continue;

      const guide = byGuide.get(cmId);
      const trend = guide?.trend ?? null;
      if (trend == null || trend < minTrend || trend > maxTrend) continue;

      const ownOnHand = ownById.get(cmId) ?? 0;
      const qtyPending = pendingById.get(cmId) ?? 0;
      const ownQty = ownOnHand + qtyPending;

      // simple cap
      const baseCap = trend >= 100 ? 4 : 8;
      const maxBuy = Math.max(baseCap - ownQty, 0);
      if (maxBuy <= 0) continue;

      let ctMin: number | null = null;
      let marginPct: number | undefined;
      let marginAbs: number | undefined;

      if (format === "arbitrage") {
        ctMin = chooseCtMinPrice(r.set, byCt.get(cmId));
        if (!ctMin) continue;

        marginAbs = ctMin - trend;
        marginPct = ctMin / trend - 1;

        if (marginAbs < minAbsMargin) continue;
        if (marginPct < minMarginPct) continue;
      }

      // wishPrice: % van trend (bij arbitrage mag je bv 90% trend betalen)
      const pct = format === "standard" ? 0.95 : 0.9; // ietsje hoger voor std
      const wishPrice = Math.round(trend * pct * 100) / 100;

      candidates.push({
        cardmarketId: cmId,
        scryfallId: r.scryfallId,
        name: r.name,
        set: r.set,
        collectorNumber: r.collectorNumber ?? null,
        rarity: r.rarity ?? null,
        tix,
        edhrecRank: r.edhrecRank ?? null,
        gameChanger: r.gameChanger ?? false,
        trend,
        foilTrend: guide?.foilTrend ?? null,
        ctMinPrice: ctMin,
        ownQty,
        ownOnHand,
        qtyPending,
        maxBuy,
        wishPrice,
        marginPct,
        marginAbs,
      });
    }

    // ---------- 4) sorteren & trimmen ----------
    candidates.sort((a, b) => {
      // arbitrage: eerst grootste marge, dan TIX
      if (format === "arbitrage") {
        const ma = a.marginPct ?? 0;
        const mb = b.marginPct ?? 0;
        if (mb !== ma) return mb - ma;
      }
      const ta = a.tix ?? 0;
      const tb = b.tix ?? 0;
      if (tb !== ta) return tb - ta;

      const ea = a.edhrecRank ?? 999999;
      const eb = b.edhrecRank ?? 999999;
      if (ea !== eb) return ea - eb;

      return b.cardmarketId - a.cardmarketId;
    });

    const items = candidates.slice(0, maxItems);

    return NextResponse.json({
      ok: true,
      format,
      maxItems,
      count: items.length,
      params: {
        minTix,
        minTrend,
        maxTrend,
        minMarginPct: format === "arbitrage" ? minMarginPct : undefined,
        minAbsMargin: format === "arbitrage" ? minAbsMargin : undefined,
      },
      items,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message ?? String(e) },
      { status: 500 }
    );
  }
}
