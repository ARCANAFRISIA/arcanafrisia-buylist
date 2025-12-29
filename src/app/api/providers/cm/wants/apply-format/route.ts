// src/app/api/providers/cm/wants/apply-format/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { buildOAuthHeader } from "@/lib/mkm";
import { getPendingQtyByCardmarketId } from "@/lib/buylistPending";

const BASE_URL = "https://api.cardmarket.com/ws/v2.0";
const GAME_ID_MTGO = 1; // Magic

// Sets die we NIET willen in arbitrage (ABU / collectors / rare promos)
const ARBITRAGE_BANNED_SETS = [
  "lea", "leb", "2ed", "3ed", "4ed", // Alpha/Beta/Unlimited/Revised/4th
  "ced", "cei",                      // Collectors / Intl. Edition
  "ptk", "p02",                      // Portal Three Kingdoms + sequel
  "arn", "atq",                      // Arabian Nights / Antiquities (veel rare dingen)
  "pelp", "palp", "pme", "pjudge",   // promo sets / player rewards (scheef geprijsd)
  "wc02", "wc01", "wc99", "wc00",    // Worlds decks
  "sld", "slx",                      // Secret Lair / extra promo
  "leg", "sum", 
];


type FormatKey = "commander" | "arbitrage" | "standard";


function roundToCents(v: number) {
  return Math.round(v * 100) / 100;
}

function headersFor(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string
): Record<string, string> {
  // buildOAuthHeader is getypt als alleen "GET" | "POST",
  // maar runtime mag je gewoon "PUT"/"DELETE" doorgeven.
  return buildOAuthHeader(method as "GET" | "POST", url, "strict", true);
}


async function mkmRequestJson(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  bodyXml?: string
): Promise<any> {
  const headers: Record<string, string> = {
    ...headersFor(method, url),
  };
  if (bodyXml) {
    headers["Content-Type"] = "application/xml; charset=utf-8";
  }

  const res = await fetch(url, {
    method,
    headers,
    cache: "no-store",
    body: bodyXml,
  });

  const txt = await res.text();

  console.log("──────── MKM DEBUG ────────");
  console.log("MKM CALL:", method, url);
  console.log("HEADERS SENT:", headers);
  console.log("BODY SENT:", bodyXml ?? "(no body)");
  console.log("STATUS:", res.status);
  console.log("RESPONSE SNIPPET:", txt.slice(0, 500));
  console.log("─────────────────────────────");

  if (!res.ok) {
    throw new Error(
      `MKM ${res.status} @ ${url} :: ${txt.slice(0, 300) || "(empty body)"}`
    );
  }

  if (!txt.trim()) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null; // XML
  }
}

/**
 * Commander-kandidaten
 */
const CURRENT_COMMANDER_SETS = [
  "c13","c14","c15","c16","c17","c18","c19","c20","c21",
  "eoc","fic","tdc","drc","dsc","blc","m3c","otc","mkc","llc",
  "woc","cmm","ltc","moc","onc","scd","brc","bot","brr","40k",
  "dmc","clb","snc","nec","voc","mic","cc2","afc","khc","zrc",
  "cc1","cmr","cm2","cma","j22","jmp","j25","bbd","rex","pip","clu",
];

const CURRENT_STANDARD_SETS = [
  "fdn","woe","lci","mkm","otj","big","blb","dsk","dft","tdm","fin","eoe","spm","tla",
];


async function getCommanderCandidates(maxItems: number) {
  const minTix = 3;
  const minTrend = 1;
  const maxTrend = 100;

  const base = await prisma.scryfallLookup.findMany({
    where: {
      cardmarketId: { gt: 0 },
      tix: {
        not: null,
        gt: minTix,
      },
      set: {
        in: CURRENT_COMMANDER_SETS,
      },
    },
    select: {
      cardmarketId: true,
      scryfallId: true,
      name: true,
      set: true,
      collectorNumber: true,
      rarity: true,
      tix: true,
      edhrecRank: true,
      gameChanger: true,
    },
    orderBy: [
      { tix: "desc" },
      { edhrecRank: "asc" },
      { cardmarketId: "desc" },
    ],
    take: maxItems * 3,
  });

  if (!base.length) {
    return { items: [], params: { minTix, minTrend, maxTrend } };
  }

  const ids = base
    .map((b) => b.cardmarketId)
    .filter((id): id is number => id != null);

  const guides = await prisma.cMPriceGuide.findMany({
    where: { cardmarketId: { in: ids } },
    select: { cardmarketId: true, trend: true, foilTrend: true },
  });

  const guideMap = new Map<
    number,
    { trend: number | null; foilTrend: number | null }
  >();
  for (const g of guides) {
    const cmId = g.cardmarketId as number;
    const trend = g.trend == null ? null : Number(g.trend);
    const foilTrend = g.foilTrend == null ? null : Number(g.foilTrend);
    guideMap.set(cmId, { trend, foilTrend });
  }

  const inv = await prisma.inventoryBalance.groupBy({
    where: { cardmarketId: { in: ids } },
    by: ["cardmarketId"],
    _sum: { qtyOnHand: true },
  });
  const ownOnHandMap = new Map<number, number>();
  for (const row of inv) {
    ownOnHandMap.set(row.cardmarketId as number, row._sum.qtyOnHand ?? 0);
  }

  const pendingMap = await getPendingQtyByCardmarketId(ids);

  const enriched = base
    .map((b) => {
      const cmId = b.cardmarketId!;
      const meta = guideMap.get(cmId);
      const trend = meta?.trend ?? null;

      if (trend == null || trend < minTrend || trend > maxTrend) {
        return null;
      }

      const ownOnHand = ownOnHandMap.get(cmId) ?? 0;
      const qtyPending = pendingMap.get(cmId) ?? 0;
      const ownQty = ownOnHand + qtyPending;

      const baseCap = trend >= 100 ? 4 : 8;
      const maxBuy = Math.max(baseCap - ownQty, 0);
      if (maxBuy <= 0) return null;

      const wishPrice = roundToCents(trend * 0.9);

      return {
        cardmarketId: cmId,
        scryfallId: b.scryfallId,
        name: b.name,
        set: b.set,
        collectorNumber: b.collectorNumber,
        rarity: b.rarity,
        tix: b.tix == null ? null : Number(b.tix),
        edhrecRank: b.edhrecRank,
        gameChanger: b.gameChanger ?? false,
        trend,
        foilTrend: meta?.foilTrend ?? null,
        ownOnHand,
        qtyPending,
        ownQty,
        maxBuy,
        wishPrice,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  enriched.sort((a, b) => {
    const at = a.tix ?? 0;
    const bt = b.tix ?? 0;
    if (bt !== at) return bt - at;
    const ae = a.edhrecRank ?? 999999;
    const be = b.edhrecRank ?? 999999;
    return ae - be;
  });

  const items = enriched.slice(0, maxItems);

  return { items, params: { minTix, minTrend, maxTrend } };
}

async function getStandardCandidates(maxItems: number) {
  const minTix = 1;
  const minTrend = 1;
  const maxTrend = 100;

  const base = await prisma.scryfallLookup.findMany({
    where: {
      cardmarketId: { gt: 0 },
      tix: { gt: minTix },
      set: { in: CURRENT_STANDARD_SETS }
    },
    select: {
      cardmarketId: true,
      scryfallId: true,
      name: true,
      set: true,
      collectorNumber: true,
      rarity: true,
      tix: true,
      gameChanger: true,
      edhrecRank: true
    },
    orderBy: [
      { tix: "desc" },
      { eur: "desc" },
      { cardmarketId: "desc" },
    ],
    take: maxItems * 4,
  });

  if (!base.length) {
    return { items: [], params: { minTix, minTrend, maxTrend } };
  }

  const ids = base.map((b) => b.cardmarketId!) as number[];

  const guides = await prisma.cMPriceGuide.findMany({
    where: { cardmarketId: { in: ids } },
    select: { cardmarketId: true, trend: true }
  });

  const trendMap = new Map<number, number>();
  for (const g of guides) {
    trendMap.set(g.cardmarketId, Number(g.trend ?? 0));
  }

  const inv = await prisma.inventoryBalance.groupBy({
    where: { cardmarketId: { in: ids } },
    by: ["cardmarketId"],
    _sum: { qtyOnHand: true },
  });

  const ownMap = new Map(inv.map((x) => [x.cardmarketId!, x._sum.qtyOnHand ?? 0]));

  const pendingMap = await getPendingQtyByCardmarketId(ids);

  const enriched = base
    .map((b) => {
      const cmId = b.cardmarketId!;
      const trend = trendMap.get(cmId) ?? 0;
      if (trend < minTrend || trend > maxTrend) return null;

      const ownQty = (ownMap.get(cmId) ?? 0) + (pendingMap.get(cmId) ?? 0);
      const baseCap = trend >= 100 ? 4 : 8;
      const maxBuy = Math.max(baseCap - ownQty, 0);
      if (maxBuy <= 0) return null;

      const wishPrice = roundToCents(trend * 0.95);

      return {
        cardmarketId: cmId,
        maxBuy,
        wishPrice,
        name: b.name,
        set: b.set,
        collectorNumber: b.collectorNumber,
      };
    })
    .filter(Boolean) as any[];

  return { items: enriched.slice(0, maxItems), params: { minTix, minTrend, maxTrend } };
}


/**
 * Wantslist helpers
 */
async function ensureWantslistId(listName: string): Promise<number> {
  const url = `${BASE_URL}/output.json/wantslist`;
  const data = await mkmRequestJson("GET", url);

  const lists = Array.isArray(data?.wantslist)
    ? data.wantslist
    : Array.isArray(data?.wantslists?.wantslist)
    ? data.wantslists.wantslist
    : [];

  const existing = lists.find(
    (wl: any) =>
      wl?.name === listName &&
      ((wl?.game?.idGame ?? wl?.idGame) === GAME_ID_MTGO)
  );

  if (existing) {
    const idExisting =
      existing.idWantsList ??
      existing.idWantslist ??
      existing.idWishlist ??
      existing.id ??
      null;

    if (!idExisting) {
      throw new Error("Kon id van bestaande wantslist niet bepalen.");
    }

    return Number(idExisting);
  }

  const createUrl = `${BASE_URL}/output.json/wantslist`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <wantslist>
    <name>${listName}</name>
    <idGame>${GAME_ID_MTGO}</idGame>
  </wantslist>
</request>`;

  const created = await mkmRequestJson("POST", createUrl, body);

  if (Array.isArray(created?.failed) && created.failed.length > 0) {
    const errMsg = created.failed[0]?.error ?? "Unknown MKM wantslist error";
    throw new Error(`MKM wantslist create failed: ${errMsg}`);
  }

  const raw = created?.wantslist;
  const wl = Array.isArray(raw) ? raw[0] : raw;

  if (!wl) {
    throw new Error("Kon aangemaakte wantslist niet uit MKM-response lezen.");
  }

  const id =
    wl.idWantsList ??
    wl.idWantslist ??
    wl.idWishlist ??
    wl.id ??
    null;

  if (!id) {
    throw new Error("Kon idWantsList van aangemaakte lijst niet bepalen.");
  }

  return Number(id);
}

async function resetWantslist(idWantslist: number): Promise<number> {
  const deleteUrl = `${BASE_URL}/output.json/wantslist/${idWantslist}`;
  await mkmRequestJson("DELETE", deleteUrl);
  return idWantslist;
}

async function addItemsToWantslist(
  idWantslist: number,
  items: Array<{
    cardmarketId: number;
    maxBuy: number;
    wishPrice: number;
  }>
) {
  if (!items.length) return;

  const url = `${BASE_URL}/output.json/wantslist/${idWantslist}`;

  const slice = items.slice(0, 150);

  const productsXml = slice
    .map(
      (it) => `
  <product>
    <idProduct>${it.cardmarketId}</idProduct>
    <count>${it.maxBuy}</count>
    <wishPrice>${it.wishPrice.toFixed(2)}</wishPrice>
    <minCondition>EX</minCondition>
    <mailAlert>false</mailAlert>
  </product>`
    )
    .join("");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <action>addItem</action>${productsXml}
</request>`;

  await mkmRequestJson("PUT", url, body);
}

/**
 * Arbitrage helpers
 */

type ArbitragePriceRow = {
  cardmarketId: number;
  cmTrend: number;
  ctMin: number;
};

async function loadArbitragePriceRows(
  maxItems: number
): Promise<ArbitragePriceRow[]> {
  // 1) Haal CT-min-prijzen op (NM/EX, non-foil), duurste eerst
  const ctRows = await prisma.cTMarketLatest.findMany({
    where: {
      cardmarketId: { gt: 0 },
      minPrice: { gt: 0 },
      bucket: { in: ["NM", "EX"] },
      isFoil: false,
    },
    select: {
      cardmarketId: true,
      minPrice: true,
    },
    orderBy: {
      minPrice: "desc",       // ⬅️ belangrijk: pak de hoogste CT-min eerst
    },
    take: maxItems * 200,      // ruimer; deze subset voeren we verder door
  });

  if (!ctRows.length) return [];

  // 2) per cardmarketId de laagste minPrice pakken (EX < NM etc.)
  const priceMap = new Map<number, number>();
  for (const row of ctRows) {
    const cmId = row.cardmarketId as number;
    const min = Number(row.minPrice);
    if (!cmId || !min) continue;
    const existing = priceMap.get(cmId);
    if (existing == null || min < existing) {
      priceMap.set(cmId, min);
    }
  }

  const ids = Array.from(priceMap.keys());
  if (!ids.length) return [];

  // 3) CM-trend erbij
  const guides = await prisma.cMPriceGuide.findMany({
    where: { cardmarketId: { in: ids } },
    select: {
      cardmarketId: true,
      trend: true,
    },
  });

  const trendMap = new Map<number, number>();
  for (const g of guides) {
    if (g.trend != null) {
      trendMap.set(g.cardmarketId as number, Number(g.trend));
    }
  }

  const result: ArbitragePriceRow[] = [];
  for (const [cmId, ctMin] of priceMap.entries()) {
    const trend = trendMap.get(cmId);
    if (!trend || trend <= 0) continue;
    if (!ctMin || ctMin <= 0) continue;

    result.push({
      cardmarketId: cmId,
      cmTrend: Number(trend),
      ctMin: Number(ctMin),
    });
  }

  return result;
}


async function getArbitrageCandidates(maxItems: number) {
  // Basisfilters
  const minTrend = 3;            // kaart moet op CM ook wat waard zijn
  const minCtPrice = 5;          // CT-min idem
  const minProfitAbs = 1.5;      // min €1,50 marge
  const minProfitPct = 0.25;     // min 20% marge t.o.v. koopprijs

  // Extra: CT-min moet echt significant boven CM-trend liggen
  const minCtVsCmDiffAbs = 4;    // min €4 verschil
  const minCtVsCmDiffPct = 0.15; // én min 15% hoger dan trend

  // Hard cap: we willen niet in super high-end / ABU zitten
  const maxCtPrice = 300;        // CT-min > 300 skippen
  const maxTrend = 250;          // trend > 250 skippen

  const baseRows = await loadArbitragePriceRows(maxItems);

  if (!baseRows.length) {
    return {
      items: [],
      params: {
        minTrend,
        minCtPrice,
        minProfitAbs,
        minProfitPct,
        minCtVsCmDiffAbs,
        minCtVsCmDiffPct,
        maxCtPrice,
        maxTrend,
      },
    };
  }

  const ids = baseRows.map((r) => r.cardmarketId);

  // eigen voorraad
  const inv = await prisma.inventoryBalance.groupBy({
    where: { cardmarketId: { in: ids } },
    by: ["cardmarketId"],
    _sum: { qtyOnHand: true },
  });
  const ownOnHandMap = new Map<number, number>();
  for (const row of inv) {
    ownOnHandMap.set(row.cardmarketId as number, row._sum.qtyOnHand ?? 0);
  }

  // pending buylist
  const pendingMap = await getPendingQtyByCardmarketId(ids);

  // meta-data uit ScryfallLookup
  const metaRows = await prisma.scryfallLookup.findMany({
    where: { cardmarketId: { in: ids } },
    select: {
      cardmarketId: true,
      scryfallId: true,
      name: true,
      set: true,
      collectorNumber: true,
      edhrecRank: true,
      gameChanger: true,
    },
  });
  const metaMap = new Map<number, (typeof metaRows)[number]>();
  for (const m of metaRows) {
    metaMap.set(m.cardmarketId!, m);
  }

  const enriched = baseRows
    .map((row) => {
      const cmId = row.cardmarketId;
      const trend = row.cmTrend;
      const ctMin = row.ctMin;

      if (!trend || trend < minTrend) return null;
      if (!ctMin || ctMin < minCtPrice) return null;

      // Hard price cap
      if (ctMin > maxCtPrice || trend > maxTrend) return null;

      const meta = metaMap.get(cmId);
      if (!meta) return null;

      // Banned sets skippen (ABU / CE / SL / promos etc.)
      const setCode = (meta.set || "").toLowerCase();
      if (ARBITRAGE_BANNED_SETS.includes(setCode)) return null;

      // Echte arbitrage: CT-min duidelijk boven CM-trend
      const diffAbs = ctMin - trend;
      const diffPct = diffAbs / trend;
      if (diffAbs < minCtVsCmDiffAbs || diffPct < minCtVsCmDiffPct) {
        return null;
      }

      // Koopprijs op CM: gebaseerd op CT-min & gewenste marge
      const maxWishByAbs = ctMin - minProfitAbs;
      const maxWishByPct = ctMin / (1 + minProfitPct);
      let wishPrice = Math.min(maxWishByAbs, maxWishByPct);
      wishPrice = roundToCents(wishPrice);

      if (wishPrice <= 0 || wishPrice >= ctMin) return null;

      const profitAbs = roundToCents(ctMin - wishPrice);
      const profitPct = profitAbs / wishPrice;

      if (profitAbs < minProfitAbs || profitPct < minProfitPct) {
        return null;
      }

      const ownOnHand = ownOnHandMap.get(cmId) ?? 0;
      const qtyPending = pendingMap.get(cmId) ?? 0;
      const ownQty = ownOnHand + qtyPending;

      const baseCap = trend >= 100 ? 4 : 8;
      const maxBuy = Math.max(baseCap - ownQty, 0);
      if (maxBuy <= 0) return null;

      return {
        cardmarketId: cmId,
        scryfallId: meta.scryfallId ?? null,
        name: meta.name ?? null,
        set: meta.set ?? null,
        collectorNumber: meta.collectorNumber ?? null,
        edhrecRank: meta.edhrecRank ?? null,
        gameChanger: meta.gameChanger ?? false,
        trend,
        ctMin,
        profitAbs,
        profitPct,
        ownOnHand,
        qtyPending,
        ownQty,
        maxBuy,
        wishPrice,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  // sorteren op absolute winst, dan % winst, dan EDHREC
  enriched.sort((a, b) => {
    if (b.profitAbs !== a.profitAbs) return b.profitAbs - a.profitAbs;
    if (b.profitPct !== a.profitPct) return b.profitPct - a.profitPct;
    const ae = a.edhrecRank ?? 999999;
    const be = b.edhrecRank ?? 999999;
    return ae - be;
  });

  const items = enriched.slice(0, maxItems);

  return {
    items,
    params: {
      minTrend,
      minCtPrice,
      minProfitAbs,
      minProfitPct,
      minCtVsCmDiffAbs,
      minCtVsCmDiffPct,
      maxCtPrice,
      maxTrend,
    },
  };
}

/**
 * POST: lijst naar MKM pushen
 * GET: alleen preview JSON voor UI
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const format = (url.searchParams.get("format") || "commander")
      .toLowerCase() as FormatKey;

    const maxItems = 150;
    let items: Array<{ cardmarketId: number; maxBuy: number; wishPrice: number }> =
      [];
    let params: any = {};
    let listName = "";

    if (format === "commander") {
      listName = "AF Cmdr";
      const res = await getCommanderCandidates(maxItems);
      params = res.params;

      if (!res.items.length) {
        return NextResponse.json({
          ok: false,
          format,
          listName,
          message: "Geen geschikte kaarten gevonden voor Commander.",
          params,
        });
      }

      items = res.items
        .filter((it) => it.maxBuy > 0 && it.wishPrice > 0)
        .map((it) => ({
          cardmarketId: it.cardmarketId,
          maxBuy: it.maxBuy,
          wishPrice: it.wishPrice,
        }));
        } else if (format === "standard") {
  listName = "AF Standard";
  const res = await getStandardCandidates(maxItems);
  params = res.params;

  if (!res.items.length) {
    return NextResponse.json({
      ok: false,
      format,
      listName,
      message: "Geen geschikte kaarten gevonden voor Standard.",
      params,
    });
  }

  items = res.items
    .filter((x) => x.maxBuy > 0 && x.wishPrice > 0)
    .map((x) => ({
      cardmarketId: x.cardmarketId,
      maxBuy: x.maxBuy,
      wishPrice: x.wishPrice,
    }));

    } else if (format === "arbitrage") {
      listName = "AF Arbitrage";
      const res = await getArbitrageCandidates(maxItems);
      params = res.params;

      if (!res.items.length) {
        return NextResponse.json({
          ok: false,
          format,
          listName,
          message:
            "Geen geschikte arbitrage-kaarten gevonden. Check loadArbitragePriceRows()/filters.",
          params,
        });
      }

      items = res.items.map((it) => ({
        cardmarketId: it.cardmarketId,
        maxBuy: it.maxBuy,
        wishPrice: it.wishPrice,
      }));
    } else {
      return NextResponse.json(
        { ok: false, error: `Format '${format}' nog niet geïmplementeerd.` },
        { status: 400 }
      );
    }

    if (!items.length) {
      return NextResponse.json({
        ok: false,
        format,
        listName,
        message: "Geen items met maxBuy > 0 over na filtering.",
        params,
      });
    }

    let idWantslist = await ensureWantslistId(listName);

    await resetWantslist(idWantslist);
    idWantslist = await ensureWantslistId(listName);

    await addItemsToWantslist(idWantslist, items);

    return NextResponse.json({
      ok: true,
      format,
      listName,
      params,
      wantslistId: idWantslist,
      pushedItems: Math.min(items.length, 150),
    });
  } catch (e: any) {
    console.error("APPLY-FORMAT ERROR:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const format = (url.searchParams.get("format") || "arbitrage")
      .toLowerCase() as FormatKey;

    const maxItems = 150;

    if (format !== "arbitrage") {
      return NextResponse.json(
        {
          ok: false,
          error: "GET-preview is nu alleen voor 'arbitrage' beschikbaar.",
        },
        { status: 400 }
      );
    }

    const res = await getArbitrageCandidates(maxItems);

    return NextResponse.json({
      ok: true,
      format,
      listName: "AF Arbitrage",
      params: res.params,
      candidates: res.items,
    });
  } catch (e: any) {
    console.error("ARBITRAGE PREVIEW ERROR:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
