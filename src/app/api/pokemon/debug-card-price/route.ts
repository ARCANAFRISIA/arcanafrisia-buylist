export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";

type PokemonApiCard = {
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
  abilities?: Array<{
    name?: string;
    text?: string;
    type?: string;
  }>;
  images?: {
    small?: string;
    large?: string;
  };
  set?: {
    id?: string;
    name?: string;
    series?: string;
    printedTotal?: number;
    total?: number;
    ptcgoCode?: string;
    releaseDate?: string;
  };
  cardmarket?: {
    updatedAt?: string | null;
    prices?: {
      averageSellPrice?: number | null;
      lowPrice?: number | null;
      trendPrice?: number | null;
      germanProLow?: number | null;
      suggestedPrice?: number | null;
      reverseHoloSell?: number | null;
      reverseHoloLow?: number | null;
      reverseHoloTrend?: number | null;
      lowPriceExPlus?: number | null;
      avg1?: number | null;
      avg7?: number | null;
      avg30?: number | null;
      reverseHoloAvg1?: number | null;
      reverseHoloAvg7?: number | null;
      reverseHoloAvg30?: number | null;
    } | null;
  };
};

type CmProduct = {
  idProduct: number;
  name: string;
  idCategory?: number | null;
  categoryName?: string | null;
  idExpansion?: number | null;
  idMetacard?: number | null;
  dateAdded?: string | null;
};

type CmPriceRow = {
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

type CmProductsFile = {
  version?: number;
  createdAt?: string;
  products?: CmProduct[];
};

type CmPriceFile = {
  version?: number;
  createdAt?: string;
  priceGuides?: CmPriceRow[];
};

type CmExpansion = {
  idExpansion: number;
  enName?: string | null;
  abbreviation?: string | null;
};

type CmExpansionFile = {
  ok?: boolean;
  idGame?: number;
  total?: number;
  expansions?: CmExpansion[];
};

type ScoredMatch = {
  product: CmProduct;
  expansionName: string | null;
  expansionAbbr: string | null;
  score: number;
  reasons: string[];
  nameBase: string;
  cmAttacks: string[];
  price: CmPriceRow | null;
};

type VariantCandidate = ScoredMatch & {
  effectivePrice: number | null;
  priceReason: string | null;
};

const PRODUCTS_PATH =
  process.env.POKEMON_CM_PRODUCTS_PATH ||
  "C:\\Users\\hindr\\Downloads\\products_singles_6.json";

const PRICEGUIDE_PATH =
  process.env.POKEMON_CM_PRICEGUIDE_PATH ||
  "C:\\Users\\hindr\\Downloads\\price_guide_6 (1).json";

const EXPANSIONS_PATH =
  process.env.POKEMON_CM_EXPANSIONS_PATH ||
  "C:\\Users\\hindr\\Downloads\\cardmarket-pokemon-expansions.json";

const POKEMON_API_URL = "https://api.pokemontcg.io/v2/cards";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenize(s: string): string[] {
  return normalizeText(s).split(" ").filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => normalizeText(v)).filter(Boolean)));
}

function getCmBaseName(name: string): string {
  const idx = name.indexOf("[");
  const base = idx >= 0 ? name.slice(0, idx) : name;
  return base.trim();
}

function getBracketText(name: string): string | null {
  const m = name.match(/\[(.*?)\]/);
  return m ? m[1].trim() : null;
}

function parseCmAttacks(productName: string): string[] {
  const bracket = getBracketText(productName);
  if (!bracket) return [];

  return uniqueStrings(
    bracket
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

function parsePokemonAttacks(card: PokemonApiCard): string[] {
  return uniqueStrings(
    (card.attacks ?? [])
      .map((a) => a.name ?? "")
      .filter(Boolean)
  );
}

function overlapScore(a: string[], b: string[]): { overlap: string[]; ratio: number } {
  if (!a.length || !b.length) return { overlap: [], ratio: 0 };

  const sa = new Set(a);
  const sb = new Set(b);
  const overlap: string[] = [];

  for (const v of sa) {
    if (sb.has(v)) overlap.push(v);
  }

  return {
    overlap,
    ratio: overlap.length / Math.max(sa.size, sb.size),
  };
}

function nameSimilarity(a: string, b: string): number {
  const aa = tokenize(a);
  const bb = tokenize(b);
  if (!aa.length || !bb.length) return 0;

  const sa = new Set(aa);
  const sb = new Set(bb);

  let overlap = 0;
  for (const t of sa) {
    if (sb.has(t)) overlap++;
  }

  return overlap / Math.max(sa.size, sb.size);
}

function computeEffectivePrice(row: CmPriceRow): {
  effectivePrice: number | null;
  priceReason: string;
  debug: Record<string, number | null>;
} {
  const trend = safeNum(row.trend);
  const avg1 = safeNum(row.avg1);
  const avg7 = safeNum(row.avg7);
  const avg30 = safeNum(row.avg30);
  const avg = safeNum(row.avg);
  const low = safeNum(row.low);

  const primary = [trend, avg7, avg30].filter((x): x is number => x != null);
  const debug = { trend, avg1, avg7, avg30, avg, low };

  if (primary.length >= 2) {
    const sorted = [...primary].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const trimmed = primary.filter((v) => v >= median * 0.4 && v <= median * 2.5);
    const used = trimmed.length ? trimmed : primary;

    return {
      effectivePrice: round2(used.reduce((s, v) => s + v, 0) / used.length),
      priceReason: `avg(${used.length} of trend/avg7/avg30)`,
      debug,
    };
  }

  if (trend != null) return { effectivePrice: round2(trend), priceReason: "trend", debug };
  if (avg7 != null) return { effectivePrice: round2(avg7), priceReason: "avg7", debug };
  if (avg30 != null) return { effectivePrice: round2(avg30), priceReason: "avg30", debug };
  if (avg1 != null) return { effectivePrice: round2(avg1), priceReason: "avg1", debug };
  if (avg != null) return { effectivePrice: round2(avg), priceReason: "avg", debug };
  if (low != null) return { effectivePrice: round2(low), priceReason: "low", debug };

  return { effectivePrice: null, priceReason: "no usable price", debug };
}

function getRarityBucket(rarity?: string | null): "LOW" | "MID" | "HIGH" | "PREMIUM" {
  const r = (rarity ?? "").toLowerCase().trim();

  if (r === "common" || r === "uncommon" || r === "rare") return "LOW";
  if (r.includes("holo") || r.includes("double rare")) return "MID";
  if (r.includes("ultra rare") || r.includes("illustration rare") || r.includes("special illustration rare")) {
    return "HIGH";
  }
  if (r.includes("hyper rare") || r.includes("mega hyper rare") || r.includes("secret rare")) {
    return "PREMIUM";
  }

  return "MID";
}

function pickBestVariant(candidates: ScoredMatch[], rarity?: string | null): VariantCandidate | null {
  if (!candidates.length) return null;

  const bucket = getRarityBucket(rarity);

  const enriched: VariantCandidate[] = candidates.map((c) => {
    const computed = c.price ? computeEffectivePrice(c.price) : null;
    return {
      ...c,
      effectivePrice: computed?.effectivePrice ?? null,
      priceReason: computed?.priceReason ?? null,
    };
  });

  const topScore = enriched[0]?.score ?? 0;
  const nearTop = enriched.filter((c) => c.score >= topScore - 25);

  const withPrice = nearTop.filter((c) => c.effectivePrice != null);
  if (!withPrice.length) return nearTop[0] ?? enriched[0] ?? null;

  const sortedByPrice = [...withPrice].sort(
    (a, b) => (a.effectivePrice ?? 0) - (b.effectivePrice ?? 0)
  );

  if (bucket === "LOW" || bucket === "MID") {
    return sortedByPrice[0] ?? null;
  }

  if (bucket === "HIGH") {
    return sortedByPrice[Math.floor(sortedByPrice.length / 2)] ?? sortedByPrice[0] ?? null;
  }

  return sortedByPrice[sortedByPrice.length - 1] ?? null;
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await fs.readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

async function fetchPokemonCardById(id: string): Promise<PokemonApiCard | null> {
  const apiKey = process.env.POKEMON_TCG_API_KEY;
  const url = `${POKEMON_API_URL}/${encodeURIComponent(id)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      ...(apiKey ? { "X-Api-Key": apiKey } : {}),
    },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const json = (await res.json()) as { data?: PokemonApiCard };
  return json.data ?? null;
}

function scoreCandidate(
  card: PokemonApiCard,
  product: CmProduct,
  expansionName: string | null,
  expansionAbbr: string | null,
  price: CmPriceRow | null
): ScoredMatch {
  const reasons: string[] = [];
  let score = 0;

  const pokemonName = card.name ?? "";
  const cmBaseName = getCmBaseName(product.name);
  const sim = nameSimilarity(pokemonName, cmBaseName);

  if (normalizeText(pokemonName) === normalizeText(cmBaseName)) {
    score += 100;
    reasons.push("exact base-name match");
  } else if (sim >= 0.9) {
    score += 70;
    reasons.push(`very strong base-name match (${round2(sim)})`);
  } else if (sim >= 0.6) {
    score += 35;
    reasons.push(`partial base-name match (${round2(sim)})`);
  } else {
    score -= 60;
    reasons.push(`weak base-name match (${round2(sim)})`);
  }

  const pokemonSetName = card.set?.name ?? "";
  const pokemonSetId = card.set?.id ?? "";
  const pokemonPtcgo = card.set?.ptcgoCode ?? "";
  const pokemonSeries = card.set?.series ?? "";

  const expNameNorm = normalizeText(expansionName ?? "");
  const expAbbrNorm = normalizeText(expansionAbbr ?? "");
  const setNameNorm = normalizeText(pokemonSetName);
  const setIdNorm = normalizeText(pokemonSetId);
  const ptcgoNorm = normalizeText(pokemonPtcgo);
  const seriesNorm = normalizeText(pokemonSeries);

  if (expNameNorm && setNameNorm) {
    const setSim = nameSimilarity(expansionName ?? "", pokemonSetName);
    if (setSim >= 0.95) {
      score += 120;
      reasons.push(`exact/near set-name match (${expansionName})`);
    } else if (setSim >= 0.7) {
      score += 60;
      reasons.push(`partial set-name match (${round2(setSim)})`);
    }
  }

  if (expAbbrNorm && ptcgoNorm && expAbbrNorm === ptcgoNorm) {
    score += 140;
    reasons.push(`expansion abbreviation matches ptcgoCode (${expansionAbbr})`);
  }

  if (expNameNorm && setIdNorm && expNameNorm.includes(setIdNorm)) {
    score += 20;
    reasons.push("expansion name contains pokemon set id");
  }

  if (expNameNorm && seriesNorm) {
    const seriesSim = nameSimilarity(expansionName ?? "", pokemonSeries);
    if (seriesSim >= 0.5) {
      score += 15;
      reasons.push(`series overlap with expansion (${round2(seriesSim)})`);
    }
  }

  const apiAttacks = parsePokemonAttacks(card);
  const cmAttacks = parseCmAttacks(product.name);
  const attackMatch = overlapScore(apiAttacks, cmAttacks);

  if (apiAttacks.length > 0) {
    if (attackMatch.overlap.length > 0) {
      score += 80 * attackMatch.ratio + 20 * attackMatch.overlap.length;
      reasons.push(`attack overlap: ${attackMatch.overlap.join(", ")}`);
    } else if (cmAttacks.length > 0) {
      score -= 35;
      reasons.push("attack mismatch");
    } else {
      reasons.push("no CM attacks parsed");
    }
  }

  if (price) {
    const { effectivePrice } = computeEffectivePrice(price);
    if (effectivePrice != null) {
      score += 10;
      reasons.push("has usable price row");
    } else {
      score -= 10;
      reasons.push("price row without usable price");
    }
  } else {
    score -= 20;
    reasons.push("no price row");
  }

  return {
    product,
    expansionName,
    expansionAbbr,
    score,
    reasons,
    nameBase: cmBaseName,
    cmAttacks,
    price,
  };
}

export async function GET(req: NextRequest) {
  try {
    const pokemonId = (req.nextUrl.searchParams.get("pokemonId") ?? "").trim();
    const limit = Math.max(1, Math.min(25, Number(req.nextUrl.searchParams.get("limit") ?? 10)));

    if (!pokemonId) {
      return NextResponse.json(
        {
          ok: false,
          error: "pokemonId is required",
          example: "/api/pokemon/debug-card-price?pokemonId=swsh4-25",
        },
        { status: 400 }
      );
    }

    const [card, productsFile, priceFile, expansionsFile] = await Promise.all([
      fetchPokemonCardById(pokemonId),
      readJsonFile<CmProductsFile>(PRODUCTS_PATH),
      readJsonFile<CmPriceFile>(PRICEGUIDE_PATH),
      readJsonFile<CmExpansionFile>(EXPANSIONS_PATH),
    ]);

    if (!card) {
      return NextResponse.json(
        { ok: false, error: `Pokémon card not found for id ${pokemonId}` },
        { status: 404 }
      );
    }

    const products = Array.isArray(productsFile.products) ? productsFile.products : [];
    const priceGuides = Array.isArray(priceFile.priceGuides) ? priceFile.priceGuides : [];
    const expansions = Array.isArray(expansionsFile.expansions) ? expansionsFile.expansions : [];

    const priceById = new Map<number, CmPriceRow>();
    for (const row of priceGuides) {
      if (Number.isFinite(row.idProduct)) {
        priceById.set(row.idProduct, row);
      }
    }

    const expansionById = new Map<number, CmExpansion>();
    for (const e of expansions) {
      if (Number.isFinite(e.idExpansion)) {
        expansionById.set(e.idExpansion, e);
      }
    }

    const pokemonName = card.name ?? "";
    const pokemonNameNorm = normalizeText(pokemonName);

    const candidates = products
      .filter((p) => typeof p.name === "string" && Number.isFinite(p.idProduct))
      .filter((p) => {
        const base = normalizeText(getCmBaseName(p.name));
        if (base === pokemonNameNorm) return true;

        const sim = nameSimilarity(pokemonName, getCmBaseName(p.name));
        return sim >= 0.6;
      })
      .map((p) => {
        const exp = p.idExpansion != null ? expansionById.get(Number(p.idExpansion)) : undefined;
        return scoreCandidate(
          card,
          p,
          exp?.enName ?? null,
          exp?.abbreviation ?? null,
          priceById.get(p.idProduct) ?? null
        );
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const best = pickBestVariant(candidates, card.rarity ?? null);

    return NextResponse.json({
      ok: true,
      pokemonCard: {
        id: card.id,
        name: card.name ?? null,
        number: card.number ?? null,
        rarity: card.rarity ?? null,
        rarityBucket: getRarityBucket(card.rarity ?? null),
        supertype: card.supertype ?? null,
        subtypes: card.subtypes ?? [],
        attacks: (card.attacks ?? []).map((a) => a.name ?? "").filter(Boolean),
        set: {
          id: card.set?.id ?? null,
          name: card.set?.name ?? null,
          series: card.set?.series ?? null,
          ptcgoCode: card.set?.ptcgoCode ?? null,
          releaseDate: card.set?.releaseDate ?? null,
        },
        pokemontcgCardmarket: {
          updatedAt: card.cardmarket?.updatedAt ?? null,
          prices: card.cardmarket?.prices ?? null,
        },
      },
      paths: {
        products: PRODUCTS_PATH,
        priceGuide: PRICEGUIDE_PATH,
        expansions: EXPANSIONS_PATH,
      },
      files: {
        productsCount: products.length,
        priceGuideCount: priceGuides.length,
        expansionsCount: expansions.length,
        productsCreatedAt: productsFile.createdAt ?? null,
        priceGuideCreatedAt: priceFile.createdAt ?? null,
      },
      bestMatch: best
        ? {
            idProduct: best.product.idProduct,
            name: best.product.name,
            idExpansion: best.product.idExpansion ?? null,
            expansionName: best.expansionName,
            expansionAbbr: best.expansionAbbr,
            idMetacard: best.product.idMetacard ?? null,
            score: best.score,
            reasons: best.reasons,
            cmAttacks: best.cmAttacks,
            effectivePrice: best.effectivePrice,
            priceReason: best.priceReason,
            prices: best.price
              ? {
                  avg: safeNum(best.price.avg),
                  low: safeNum(best.price.low),
                  trend: safeNum(best.price.trend),
                  avg1: safeNum(best.price.avg1),
                  avg7: safeNum(best.price.avg7),
                  avg30: safeNum(best.price.avg30),
                  avgHolo: safeNum(best.price["avg-holo"]),
                  lowHolo: safeNum(best.price["low-holo"]),
                  trendHolo: safeNum(best.price["trend-holo"]),
                  avg1Holo: safeNum(best.price["avg1-holo"]),
                  avg7Holo: safeNum(best.price["avg7-holo"]),
                  avg30Holo: safeNum(best.price["avg30-holo"]),
                }
              : null,
          }
        : null,
      candidates: candidates.map((c) => {
        const computed = c.price ? computeEffectivePrice(c.price) : null;

        return {
          idProduct: c.product.idProduct,
          name: c.product.name,
          idExpansion: c.product.idExpansion ?? null,
          expansionName: c.expansionName,
          expansionAbbr: c.expansionAbbr,
          idMetacard: c.product.idMetacard ?? null,
          score: c.score,
          reasons: c.reasons,
          cmAttacks: c.cmAttacks,
          effectivePrice: computed?.effectivePrice ?? null,
          priceReason: computed?.priceReason ?? null,
          prices: c.price
            ? {
                avg: safeNum(c.price.avg),
                low: safeNum(c.price.low),
                trend: safeNum(c.price.trend),
                avg1: safeNum(c.price.avg1),
                avg7: safeNum(c.price.avg7),
                avg30: safeNum(c.price.avg30),
                avgHolo: safeNum(c.price["avg-holo"]),
                lowHolo: safeNum(c.price["low-holo"]),
                trendHolo: safeNum(c.price["trend-holo"]),
                avg1Holo: safeNum(c.price["avg1-holo"]),
                avg7Holo: safeNum(c.price["avg7-holo"]),
                avg30Holo: safeNum(c.price["avg30-holo"]),
              }
            : null,
        };
      }),
    });
  } catch (error: any) {
    console.error("[pokemon debug-card-price] failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Internal error",
        paths: {
          products: PRODUCTS_PATH,
          priceGuide: PRICEGUIDE_PATH,
          expansions: EXPANSIONS_PATH,
        },
      },
      { status: 500 }
    );
  }
}