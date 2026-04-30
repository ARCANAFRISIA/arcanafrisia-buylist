// src/lib/pokemonBuylist.ts

export type PokemonApiCard = {
  id: string;
  name?: string;
  number?: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
  attacks?: Array<{
    name?: string;
    text?: string;
    damage?: string;
  }>;
  images?: {
    small?: string;
    large?: string;
  };
  set?: {
    id?: string;
    name?: string;
    series?: string;
    releaseDate?: string;
    ptcgoCode?: string;
  };
  cardmarket?: {
    updatedAt?: string | null;
    prices?: unknown;
  };
};

export type CmPriceRow = {
  idProduct: number;
  idCategory?: number | null;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  "avg-holo"?: number | null;
  "low-holo"?: number | null;
  "trend-holo"?: number | null;
  "avg1-holo"?: number | null;
  "avg7-holo"?: number | null;
  "avg30-holo"?: number | null;
};

export type UniverseRow = {
  idExpansion?: number;
  idProduct?: number;
  idMetaproduct?: number;
  enName?: string;
  locName?: string;
  website?: string;
  image?: string;
  categoryName?: string;
  expansionName?: string;
  number?: string;
  rarity?: string;
};

export type UniverseFile = {
  ok?: boolean;
  requestedExpansionIds?: number[];
  expansionCount?: number;
  successfulExpansionCount?: number;
  failedExpansionCount?: number;
  totalProducts?: number;
  results?: UniverseRow[];
};

export type PriceSource =
  | "trend"
  | "avg7"
  | "avg30"
  | "avg"
  | "low"
  | "blend"
  | null;

export type BuyableReason =
  | "OK"
  | "NO_PRICE"
  | "SERIES_NOT_ALLOWED"
  | "LOW_RARITY_UNDER_MIN_PRICE"
  | "PAYOUT_UNDER_MIN";

export type RarityBucket = "LOW" | "MID" | "HIGH" | "PREMIUM";

export type PokemonSearchRow = {
  id: string;
  name: string;
  setCode: string;
  setName: string;
  setSeries: string;
  number: string;
  rarity: string;
  rarityBucket: RarityBucket;
  image: string | null;
  marketPrice: number | null;
  priceSource: PriceSource;
  payout: number | null;
  supertype: string;
  cardmarketUpdatedAt: string | null;
  hasLivePrice: boolean;
  isBuyable: boolean;
  buyableReason: BuyableReason;
  debug?: {
    matchedProductId?: number | null;
    matchedExpansionName?: string | null;
    matchedNumber?: string | null;
    matchedRarity?: string | null;
    matchScore?: number | null;
  };
};

export const POKEMON_ALLOWED_SERIES = new Set([
  "Sword & Shield",
  "Scarlet & Violet",
  "Mega Evolution",
]);

export const POKEMON_LOW_RARITIES = new Set([
  "Common",
  "Uncommon",
  "Rare",
  "Holo Rare",
]);

export const POKEMON_MIN_PAYOUT_EUR = 0.35;
export const POKEMON_PAYOUT_PCT = 0.75;
export const POKEMON_MAX_QTY_PER_CARD = 8;
export const POKEMON_LOW_RARITY_MIN_PRICE = 1.5;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function roundDown2(n: number): number {
  return Math.floor(n * 100) / 100;
}

export function asNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeNumber(s?: string | null): string {
  const raw = (s ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replace(/^0+(\d)/, "$1");
}

export function normalizeRarity(s?: string | null): string {
  return normalizeText(s ?? "");
}

export function isPokemonSeriesAllowed(series?: string | null): boolean {
  const s = (series ?? "").trim();
  return POKEMON_ALLOWED_SERIES.has(s);
}

export function isLowPokemonRarity(rarity?: string | null): boolean {
  const r = (rarity ?? "").trim();
  return POKEMON_LOW_RARITIES.has(r);
}

export function getRarityBucket(rarity?: string | null): RarityBucket {
  const r = normalizeRarity(rarity);

  if (r.includes("mega hyper rare") || r.includes("hyper rare") || r.includes("secret rare")) {
    return "PREMIUM";
  }

  if (
    r.includes("special illustration rare") ||
    r.includes("illustration rare") ||
    r.includes("ultra rare")
  ) {
    return "HIGH";
  }

  if (r.includes("double rare") || r.includes("holo")) {
    return "MID";
  }

  return "LOW";
}

export function computePokemonPayout(marketPrice: number | null): number | null {
  if (marketPrice == null || marketPrice <= 0) return null;

  const payout = roundDown2(marketPrice * POKEMON_PAYOUT_PCT);
  if (payout < POKEMON_MIN_PAYOUT_EUR) return null;

  return payout;
}

export function computeEffectivePrice(row: CmPriceRow): {
  effectivePrice: number | null;
  priceReason: PriceSource;
} {
  const trend = asNumberOrNull(row.trend);
  const avg7 = asNumberOrNull(row.avg7);
  const avg30 = asNumberOrNull(row.avg30);
  const avg = asNumberOrNull(row.avg);
  const low = asNumberOrNull(row.low);

  const primary = [trend, avg7, avg30].filter((x): x is number => x != null);

  if (primary.length >= 2) {
    return {
      effectivePrice: round2(primary.reduce((s, v) => s + v, 0) / primary.length),
      priceReason: "blend",
    };
  }

  if (trend != null) return { effectivePrice: round2(trend), priceReason: "trend" };
  if (avg7 != null) return { effectivePrice: round2(avg7), priceReason: "avg7" };
  if (avg30 != null) return { effectivePrice: round2(avg30), priceReason: "avg30" };
  if (avg != null) return { effectivePrice: round2(avg), priceReason: "avg" };
  if (low != null) return { effectivePrice: round2(low), priceReason: "low" };

  return { effectivePrice: null, priceReason: null };
}

export function scoreUniverseMatch(card: PokemonApiCard, row: UniverseRow): number {
  let score = 0;

  const cardSet = normalizeText(card.set?.name ?? "");
  const cardName = normalizeText(card.name ?? "");
  const cardNumber = normalizeNumber(card.number);
  const cardRarity = normalizeRarity(card.rarity);
  const cardBucket = getRarityBucket(card.rarity);

  const rowSet = normalizeText(row.expansionName ?? "");
  const rowName = normalizeText(row.enName ?? row.locName ?? "");
  const rowNumber = normalizeNumber(row.number);
  const rowRarity = normalizeRarity(row.rarity);
  const rowBucket = getRarityBucket(row.rarity);

  if (cardSet && rowSet) {
    if (cardSet === rowSet) score += 300;
  }

  if (cardNumber && rowNumber) {
    if (cardNumber === rowNumber) score += 400;
  }

  if (cardName && rowName) {
    if (cardName === rowName) score += 200;
  }

  if (cardRarity && rowRarity) {
    if (cardRarity === rowRarity) score += 120;
    else if (cardBucket === rowBucket) score += 40;
    else score -= 40;
  }

  return score;
}