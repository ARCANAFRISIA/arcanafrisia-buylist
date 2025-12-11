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

const CURRENT_PIONEER_SETS = [
  "aer",
"afr",
"akh",
"bfz",
"bng",
"bro",
"brr",
"dar",
"dgm",
"dmu",
"dtk",
"eld",
"emn",
"frf",
"grn",
"gtc",
"hou",
"iko",
"jou",
"khm",
"kld",
"ktk",
"m14",
"m15",
"m19",
"m20",
"m21",
"mat",
"mid",
"moc",
"mom",
"neo",
"ogw",
"one",
"ori",
"rix",
"rna",
"rtr",
"snc",
"soi",
"stx",
"thb",
"ths",
"vow",
"war",
"xln",
"znr",

];

const CURRENT_MODERN_SETS = [
"mh3",
"mh2",
"mh1",
"ltr",
"acr",
"mm3",
"mm2",
"mma",
"ddj",
"v12",
"m13",
"pc2",
"avr",
"hel",
"ddi",
"dka",
"pd3",
"isd",
"ddh",
"v11",
"m12",
"td2",
"nph",
"ddg",
"mbs",
"lgc",
"som",
"ddf",
"v10",
"m11",
"dpa",
"roe",
"dde",
"wwk",
"h09",
"ddd",
"zen",
"m10",
"arb",
"ddc",
"url",
"con",
"dtp",
"dd2",
"ala",
"drb",
"eve",
"shm",
"mor",
"dd1",
"lrw",
"10e",
"fut",
"plc",
"tsp",
"tsb",
"csp",
"dis",
"gpt",
"rav",
"sal",
"9ed",
"sok",
"bok",
"chk",
"5dn",
"dst",
"mrd",
"8ed",
];

const CURRENT_COMMANDER_SETS = [
"c13",
"c14",
"c15",
"c16",
"c17",
"c18",
"c19",
"c20",
"c21",
"eoc",
"fic",
"tdc",
"drc",
"dsc",
"blc",
"m3c",
"otc",
"mkc",
"llc",
"woc",
"cmm",
"ltc",
"moc",
"onc",
"scd",
"brc",
"bot",
"brr",
"40k",
"dmc",
"clb",
"snc",
"nec",
"voc",
"mic",
"cc2",
"afc",
"khc",
"zrc",
"cc1",
"cmr",
"cm2",
"cma",
"j22",
"jmp",
"j25",
"bbd",
"rex",
"pip",
"clu",


];

const CURRENT_LEGACY_SETS = [
"scg",
"lgn",
"ons",
"tor",
"ody",
"apc",
"7ed",
"pls",
"inv",
"btd",
"pcy",
"nem",
"brb",
"mmq",
"uds",
"ptk",
"6ed",
"ulg",
"ath",
"usg",
"ugl",
"p02",
"exo",
"sth",
"tmp",
"wth",
"por",
"5ed",
"vis",
"mir",
"all",
"hml",
"ren",
"chr",
"ice",
"4ed",
"fem",
"drk",
"leg",
"3ed",
"fbb",
"atq",
"arn",
"2ed",
];

const CURRENT_SPECIALS_SETS = [
  "znl",
  "spg",
  "unf",
  "ugl",
  "unh",
  "und",
  "ust",
  "mb1",
  "mb2",
  "lst",
  "sld",
  "slc",

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
  where.set = setParam;

} else if (formatParam === "standard") {
  where.set = { in: CURRENT_STANDARD_SETS };

} else if (formatParam === "modern") {
  where.set = { in: CURRENT_MODERN_SETS };

} else if (formatParam === "pioneer") {
  where.set = { in: CURRENT_PIONEER_SETS };

} else if (formatParam === "legacy") {
  where.set = { in: CURRENT_LEGACY_SETS };

} else if (formatParam === "commander") {
  where.set = { in: CURRENT_COMMANDER_SETS };


} else if (formatParam === "specials" || formatParam === "vintage") {
  // support beide, just in case
  where.set = { in: CURRENT_SPECIALS_SETS };

} else {
  // fallback: alles behalve oude rommel
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
 // Alleen legalities gebruiken voor echte formats waar een key voor bestaat
const LEGALITY_KEYS = [
  "standard",
  "modern",
  "legacy",
  "pioneer",
  "premodern",
  "pauper",
  "commander",
  // GEEN "vintage" en GEEN "specials"
];

if (formatParam && LEGALITY_KEYS.includes(formatParam)) {
  (where as any).legalities = {
    path: ["set", formatParam],
    equals: "legal",
  };
}




  // gebruik je een filter? (dan wat ruimer ophalen)
  const hasFilter =
    !!setParam || !!rarityParam || !!formatParam || q.length >= 2;

  // basis: 300, maar als gebruiker actief filtert → 500
  const take = hasFilter ? 500 : 300;

  // ------- standaard ORDER BY logica -------
  
  let orderBy:
    | Prisma.ScryfallLookupOrderByWithRelationInput
    | Prisma.ScryfallLookupOrderByWithRelationInput[];

  const isNameSearch = q.length >= 2;
  const hasExtraFilters = !!setParam || !!rarityParam;

  if (!isNameSearch && formatParam && !hasExtraFilters) {
    // 🧭 Pure "format browse" (Standard / Modern / Pioneer / etc.)
    // zonder set, zonder rarity, zonder naamzoek
    orderBy = [
      { tix: "desc" },        // eerst kaarten met MTGO-waarde
      { edhrecRank: "asc" },  // dan populaire EDH kaarten
      { cardmarketId: "desc" } // bij gelijke score: nieuwere CM-IDs eerst
    ];
  } else if (!isNameSearch && !formatParam && !hasExtraFilters) {
    // 🌍 Volledig browse zonder filters: alle formats, geen set, geen rarity, geen naam
    // -> simpelweg nieuwste kaarten eerst
    orderBy = { cardmarketId: "desc" };
  } else {
    // 🔎 Naam-zoek of extra filters (set/rarity) -> stabiel op cardmarketId ASC
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
