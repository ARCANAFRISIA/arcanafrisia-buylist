export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  type PokemonApiCard,
  type PokemonSearchRow,
  type UniverseFile,
  type UniverseRow,
  type CmPriceRow,
  POKEMON_ALLOWED_SERIES,
  isPokemonSeriesAllowed,
  isLowPokemonRarity,
  computePokemonPayout,
  computeEffectivePrice,
  getRarityBucket,
  normalizeText,
  normalizeNumber,
} from "@/lib/pokemonBuylist";

type CmPriceFile = {
  version?: number;
  createdAt?: string;
  priceGuides?: CmPriceRow[];
};

type SearchMeta = {
  availableSeries: string[];
  availableSets: string[];
  availableRarities: string[];
  availableSupertypes: string[];
};

type SortKey =
  | "relevance"
  | "name_asc"
  | "name_desc"
  | "price_desc"
  | "price_asc"
  | "payout_desc"
  | "payout_asc"
  | "set_asc"
  | "number_asc";

const API_URL = "https://api.pokemontcg.io/v2/cards";
const PAGE_SIZE = 120;

const UNIVERSE_PATH =
  process.env.POKEMON_CM_UNIVERSE_PATH ||
  "C:\\Users\\hindr\\Downloads\\cardmarket-pokemon-swsh-to-current-buylist-universe.json";

const PRICEGUIDE_PATH =
  process.env.POKEMON_CM_PRICEGUIDE_PATH ||
  "C:\\Users\\hindr\\Downloads\\price_guide_6 (1).json";

let loaded = false;
let universeRows: UniverseRow[] = [];
let priceById = new Map<number, CmPriceRow>();
let universeBySetNumber = new Map<string, UniverseRow[]>();

let searchMeta: SearchMeta = {
  availableSeries: [],
  availableSets: [],
  availableRarities: [],
  availableSupertypes: ["Pokémon", "Trainer", "Energy"],
};

function escapeLucene(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"').trim();
}

function buildQuotedClause(field: string, value: string): string {
  return `${field}:"${escapeLucene(value)}"`;
}

function buildNameClause(raw: string): string {
  const q = escapeLucene(raw);
  return q.includes(" ") ? `name:"${q}"` : `name:${q}`;
}

function isProductRow(row: UniverseRow): boolean {
  return (
    Number.isFinite(row.idProduct) &&
    !!row.expansionName &&
    !!row.enName &&
    row.number != null &&
    String(row.number).trim() !== ""
  );
}

function getSetNumberKey(setName: string, number: string): string {
  return `${normalizeText(setName)}::${normalizeNumber(number)}`;
}

function parseSearchInput(input: string): {
  rawQuery: string;
  nameQuery: string;
  numberQuery: string;
} {
  const rawQuery = input.trim();
  if (!rawQuery) {
    return { rawQuery: "", nameQuery: "", numberQuery: "" };
  }

  const parts = rawQuery.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";

  const looksLikeCardNumber =
    parts.length >= 2 &&
    /^[a-z0-9/-]+$/i.test(last) &&
    /\d/.test(last);

  if (looksLikeCardNumber) {
    return {
      rawQuery,
      nameQuery: parts.slice(0, -1).join(" ").trim(),
      numberQuery: last.trim(),
    };
  }

  return {
    rawQuery,
    nameQuery: rawQuery,
    numberQuery: "",
  };
}

function loadLocalFiles() {
  if (loaded) return;

  const universeRaw = fs.readFileSync(UNIVERSE_PATH, "utf8");
  const pricesRaw = fs.readFileSync(PRICEGUIDE_PATH, "utf8");

  const universeFile = JSON.parse(universeRaw) as UniverseFile & {
    products?: UniverseRow[];
  };
  const pricesFile = JSON.parse(pricesRaw) as CmPriceFile;

  universeRows = (universeFile.products ?? []).filter(isProductRow);

  priceById = new Map<number, CmPriceRow>();
  for (const row of pricesFile.priceGuides ?? []) {
    if (Number.isFinite(row.idProduct)) {
      priceById.set(row.idProduct, row);
    }
  }

  universeBySetNumber = new Map<string, UniverseRow[]>();
  const setNames = new Set<string>();
  const rarities = new Set<string>();

  for (const row of universeRows) {
    const setName = String(row.expansionName ?? "").trim();
    const rarity = String(row.rarity ?? "").trim();
    const number = String(row.number ?? "").trim();

    if (setName) setNames.add(setName);
    if (rarity) rarities.add(rarity);

    if (setName && number) {
      const key = getSetNumberKey(setName, number);
      const arr = universeBySetNumber.get(key);
      if (arr) arr.push(row);
      else universeBySetNumber.set(key, [row]);
    }
  }

  searchMeta = {
    availableSeries: Array.from(POKEMON_ALLOWED_SERIES).sort((a, b) => a.localeCompare(b)),
    availableSets: Array.from(setNames).sort((a, b) => a.localeCompare(b)),
    availableRarities: Array.from(rarities).sort((a, b) => a.localeCompare(b)),
    availableSupertypes: ["Pokémon", "Trainer", "Energy"],
  };

  loaded = true;

  console.log("[pokemon/search] local files loaded", {
    universeRows: universeRows.length,
    priceRows: priceById.size,
    availableSets: searchMeta.availableSets.length,
    availableRarities: searchMeta.availableRarities.length,
    setNumberIndex: universeBySetNumber.size,
  });
}

function findExactUniverseRow(card: PokemonApiCard): UniverseRow | null {
  const setName = card.set?.name ?? "";
  const number = card.number ?? "";
  const name = normalizeText(card.name ?? "");

  if (!setName || !number) return null;

  const key = getSetNumberKey(setName, number);
  const sameSetAndNumber = universeBySetNumber.get(key) ?? [];

  if (!sameSetAndNumber.length) return null;

  const exactName = sameSetAndNumber.find((row) => {
    return normalizeText(row.enName ?? row.locName ?? "") === name;
  });

  return exactName ?? sameSetAndNumber[0] ?? null;
}

function pickBestRow(card: PokemonApiCard): {
  row: UniverseRow | null;
  marketPrice: number | null;
  priceSource: PokemonSearchRow["priceSource"];
  matchScore: number | null;
} {
  const row = findExactUniverseRow(card);

  if (!row || row.idProduct == null) {
    return { row: null, marketPrice: null, priceSource: null, matchScore: null };
  }

  const price = priceById.get(Number(row.idProduct)) ?? null;
  if (!price) {
    return { row, marketPrice: null, priceSource: null, matchScore: 1 };
  }

  const computed = computeEffectivePrice(price);

  return {
    row,
    marketPrice: computed.effectivePrice,
    priceSource: computed.priceReason,
    matchScore: 1000,
  };
}

function normalizeCard(card: PokemonApiCard): PokemonSearchRow | null {
  const setSeries = card.set?.series ?? "";
  if (!isPokemonSeriesAllowed(setSeries)) return null;

  const rarity = card.rarity ?? "";
  const rarityBucket = getRarityBucket(rarity);

  const picked = pickBestRow(card);

  const marketPrice = picked.marketPrice;
  const priceSource = picked.priceSource;
  const hasLivePrice = marketPrice != null;

  let isBuyable = false;
  let buyableReason: PokemonSearchRow["buyableReason"] = "OK";
  let payout: number | null = null;

  if (!hasLivePrice) {
    buyableReason = "NO_PRICE";
  } else if (isLowPokemonRarity(rarity) && marketPrice < 1.5) {
    buyableReason = "LOW_RARITY_UNDER_MIN_PRICE";
  } else {
    payout = computePokemonPayout(marketPrice);
    if (payout == null) {
      buyableReason = "PAYOUT_UNDER_MIN";
    } else {
      isBuyable = true;
      buyableReason = "OK";
    }
  }

  return {
    id: card.id,
    name: card.name ?? "",
    setCode: card.set?.id ?? "",
    setName: card.set?.name ?? "",
    setSeries,
    number: card.number ?? "",
    rarity,
    rarityBucket,
    image: card.images?.small ?? card.images?.large ?? null,
    marketPrice,
    priceSource,
    payout,
    supertype: card.supertype ?? "",
    cardmarketUpdatedAt: card.cardmarket?.updatedAt ?? null,
    hasLivePrice,
    isBuyable,
    buyableReason,
    debug: {
      matchedProductId: picked.row?.idProduct ?? null,
      matchedExpansionName: picked.row?.expansionName ?? null,
      matchedNumber: picked.row?.number ?? null,
      matchedRarity: picked.row?.rarity ?? null,
      matchScore: picked.matchScore,
    },
  };
}

function buildUpstreamQuery(input: {
  nameQuery: string;
  setName: string;
  setSeries: string;
  rarity: string;
  supertype: string;
}): string {
  const clauses: string[] = [];

  if (input.nameQuery) clauses.push(buildNameClause(input.nameQuery));
  if (input.setName) clauses.push(buildQuotedClause("set.name", input.setName));
  if (input.setSeries) clauses.push(buildQuotedClause("set.series", input.setSeries));
  if (input.rarity) clauses.push(buildQuotedClause("rarity", input.rarity));
  if (input.supertype) clauses.push(buildQuotedClause("supertype", input.supertype));

  return clauses.join(" ");
}

function computeRelevanceScore(
  item: PokemonSearchRow,
  parsed: { nameQuery: string; numberQuery: string }
): number {
  let score = 0;

  const itemName = normalizeText(item.name);
  const queryName = normalizeText(parsed.nameQuery);
  const itemNumber = normalizeNumber(item.number);
  const queryNumber = normalizeNumber(parsed.numberQuery);

  if (queryName) {
    if (itemName === queryName) score += 500;
    else if (itemName.startsWith(queryName)) score += 250;
    else if (itemName.includes(queryName)) score += 120;
  }

  if (queryNumber) {
    if (itemNumber === queryNumber) score += 700;
    else if (itemNumber.startsWith(queryNumber)) score += 150;
  }

  if (item.isBuyable) score += 40;
  if (item.marketPrice != null) score += Math.min(item.marketPrice, 200);

  return score;
}

function sortItems(
  items: PokemonSearchRow[],
  sort: SortKey,
  parsed: { nameQuery: string; numberQuery: string }
): PokemonSearchRow[] {
  const copy = [...items];

  copy.sort((a, b) => {
    if (sort === "name_asc") return a.name.localeCompare(b.name);
    if (sort === "name_desc") return b.name.localeCompare(a.name);

    if (sort === "price_desc") return (b.marketPrice ?? -1) - (a.marketPrice ?? -1);
    if (sort === "price_asc") return (a.marketPrice ?? 999999) - (b.marketPrice ?? 999999);

    if (sort === "payout_desc") return (b.payout ?? -1) - (a.payout ?? -1);
    if (sort === "payout_asc") return (a.payout ?? 999999) - (b.payout ?? 999999);

    if (sort === "set_asc") {
      const setDiff = a.setName.localeCompare(b.setName);
      if (setDiff !== 0) return setDiff;
      return a.name.localeCompare(b.name);
    }

    if (sort === "number_asc") {
      return a.number.localeCompare(b.number, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    const relDiff = computeRelevanceScore(b, parsed) - computeRelevanceScore(a, parsed);
    if (relDiff !== 0) return relDiff;

    const buyableDiff = Number(b.isBuyable) - Number(a.isBuyable);
    if (buyableDiff !== 0) return buyableDiff;

    const priceDiff = (b.marketPrice ?? 0) - (a.marketPrice ?? 0);
    if (priceDiff !== 0) return priceDiff;

    return a.name.localeCompare(b.name);
  });

  return copy;
}

export async function GET(req: NextRequest) {
  try {
    loadLocalFiles();

    const query = (req.nextUrl.searchParams.get("query") ?? "").trim();
    const setName = (req.nextUrl.searchParams.get("setName") ?? "").trim();
    const setSeries = (req.nextUrl.searchParams.get("setSeries") ?? "").trim();
    const rarity = (req.nextUrl.searchParams.get("rarity") ?? "").trim();
    const supertype = (req.nextUrl.searchParams.get("supertype") ?? "").trim();
    const sort = ((req.nextUrl.searchParams.get("sort") ?? "relevance").trim() ||
      "relevance") as SortKey;
    const buyableOnly = req.nextUrl.searchParams.get("buyableOnly") === "1";

    const parsed = parseSearchInput(query);

    const hasCriteria =
      parsed.nameQuery.length >= 2 ||
      !!setName ||
      !!setSeries ||
      !!rarity ||
      !!supertype ||
      buyableOnly;

    if (!hasCriteria) {
      return NextResponse.json({
        ok: true,
        items: [],
        meta: searchMeta,
        debug: {
          query,
          reason: "no_search_criteria",
        },
      });
    }

    const apiKey = process.env.POKEMON_TCG_API_KEY;
    const searchQuery = buildUpstreamQuery({
      nameQuery: parsed.nameQuery,
      setName,
      setSeries,
      rarity,
      supertype,
    });

    const upstreamUrl = new URL(API_URL);
    upstreamUrl.searchParams.set("q", searchQuery);
    upstreamUrl.searchParams.set("pageSize", String(PAGE_SIZE));
    upstreamUrl.searchParams.set("orderBy", "-set.releaseDate,name,number");

    const res = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: {
        ...(apiKey ? { "X-Api-Key": apiKey } : {}),
      },
      cache: "no-store",
    });

    const text = await res.text();

    if (!res.ok) {
      console.error("Pokemon API upstream error:", res.status, text);
      return NextResponse.json(
        {
          ok: false,
          error: "Pokemon API search failed",
          status: res.status,
          details: text,
          meta: searchMeta,
        },
        { status: 502 }
      );
    }

    let data: { data?: PokemonApiCard[] };
    try {
      data = JSON.parse(text) as { data?: PokemonApiCard[] };
    } catch (error) {
      console.error("Pokemon API returned invalid JSON:", error, text?.slice(0, 500));
      return NextResponse.json(
        {
          ok: false,
          error: "Pokemon API returned invalid JSON",
          meta: searchMeta,
        },
        { status: 502 }
      );
    }

    const rawCards = data.data ?? [];

    let items = rawCards
      .map(normalizeCard)
      .filter((x): x is PokemonSearchRow => x !== null);

    if (parsed.numberQuery) {
      const wanted = normalizeNumber(parsed.numberQuery);
      items = items.filter((card) => normalizeNumber(card.number) === wanted);
    }

    if (setName) {
      items = items.filter((card) => card.setName === setName);
    }

    if (setSeries) {
      items = items.filter((card) => card.setSeries === setSeries);
    }

    if (rarity) {
      items = items.filter((card) => card.rarity === rarity);
    }

    if (supertype) {
      items = items.filter((card) => card.supertype === supertype);
    }

    if (buyableOnly) {
      items = items.filter((card) => card.isBuyable);
    }

    items = sortItems(items, sort, parsed);

    return NextResponse.json({
      ok: true,
      meta: searchMeta,
      debug: {
        query,
        parsedNameQuery: parsed.nameQuery,
        parsedNumberQuery: parsed.numberQuery,
        searchQuery,
        setName,
        setSeries,
        rarity,
        supertype,
        sort,
        buyableOnly,
        upstreamCount: rawCards.length,
        normalizedCount: items.length,
        buyableCount: items.filter((x) => x.isBuyable).length,
        withLivePrice: items.filter((x) => x.hasLivePrice).length,
        withoutLivePrice: items.filter((x) => !x.hasLivePrice).length,
      },
      items,
    });
  } catch (error) {
    console.error("GET /api/pokemon/search failed", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}