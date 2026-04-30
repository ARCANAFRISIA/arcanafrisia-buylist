export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";

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

const PRODUCTS_PATH =
  process.env.POKEMON_CM_PRODUCTS_PATH ||
  "C:\\Users\\hindr\\Downloads\\products_singles_6.json";

const PRICEGUIDE_PATH =
  process.env.POKEMON_CM_PRICEGUIDE_PATH ||
  "C:\\Users\\hindr\\Downloads\\price_guide_6 (1).json";

function safeNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatches(productName: string, query: string): boolean {
  const p = normalizeForSearch(productName);
  const q = normalizeForSearch(query);

  if (!q) return false;
  if (p.includes(q)) return true;

  const words = q.split(" ").filter(Boolean);
  return words.every((w) => p.includes(w));
}

/**
 * Heuristic v1:
 * - use trend / avg7 / avg30 as primary stable fields
 * - if at least 2 of those exist -> average them
 * - else fallback to trend -> avg7 -> avg30 -> avg1 -> avg -> low
 * - ignore obvious outliers around the median if we have enough values
 */
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

    const effectivePrice = round2(used.reduce((s, v) => s + v, 0) / used.length);
    return {
      effectivePrice,
      priceReason: `avg(${used.length} of trend/avg7/avg30)`,
      debug,
    };
  }

  if (trend != null) {
    return { effectivePrice: round2(trend), priceReason: "trend", debug };
  }
  if (avg7 != null) {
    return { effectivePrice: round2(avg7), priceReason: "avg7", debug };
  }
  if (avg30 != null) {
    return { effectivePrice: round2(avg30), priceReason: "avg30", debug };
  }
  if (avg1 != null) {
    return { effectivePrice: round2(avg1), priceReason: "avg1", debug };
  }
  if (avg != null) {
    return { effectivePrice: round2(avg), priceReason: "avg", debug };
  }
  if (low != null) {
    return { effectivePrice: round2(low), priceReason: "low", debug };
  }

  return { effectivePrice: null, priceReason: "no usable price", debug };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await fs.readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

export async function GET(req: NextRequest) {
  try {
    const query = (req.nextUrl.searchParams.get("query") ?? "").trim();
    const limit = Math.max(
      1,
      Math.min(100, Number(req.nextUrl.searchParams.get("limit") ?? 30))
    );

    if (query.length < 2) {
      return NextResponse.json(
        {
          ok: false,
          error: "Query must be at least 2 characters",
          example:
            "/api/pokemon/debug-cm-match?query=charizard&limit=20",
        },
        { status: 400 }
      );
    }

    const [productsFile, priceFile] = await Promise.all([
      readJsonFile<CmProductsFile>(PRODUCTS_PATH),
      readJsonFile<CmPriceFile>(PRICEGUIDE_PATH),
    ]);

    const products = Array.isArray(productsFile.products) ? productsFile.products : [];
    const priceGuides = Array.isArray(priceFile.priceGuides) ? priceFile.priceGuides : [];

    const priceById = new Map<number, CmPriceRow>();
    for (const row of priceGuides) {
      if (Number.isFinite(row.idProduct)) {
        priceById.set(row.idProduct, row);
      }
    }

    const matches = products
      .filter((p) => Number.isFinite(p.idProduct) && typeof p.name === "string")
      .filter((p) => nameMatches(p.name, query))
      .map((p) => {
        const price = priceById.get(p.idProduct);
        const computed = price
          ? computeEffectivePrice(price)
          : {
              effectivePrice: null,
              priceReason: "no price row",
              debug: {
                trend: null,
                avg1: null,
                avg7: null,
                avg30: null,
                avg: null,
                low: null,
              },
            };

        return {
          idProduct: p.idProduct,
          name: p.name,
          idCategory: p.idCategory ?? null,
          categoryName: p.categoryName ?? null,
          idExpansion: p.idExpansion ?? null,
          idMetacard: p.idMetacard ?? null,
          effectivePrice: computed.effectivePrice,
          priceReason: computed.priceReason,
          prices: price
            ? {
                avg: safeNum(price.avg),
                low: safeNum(price.low),
                trend: safeNum(price.trend),
                avg1: safeNum(price.avg1),
                avg7: safeNum(price.avg7),
                avg30: safeNum(price.avg30),
                avgHolo: safeNum(price["avg-holo"]),
                lowHolo: safeNum(price["low-holo"]),
                trendHolo: safeNum(price["trend-holo"]),
                avg1Holo: safeNum(price["avg1-holo"]),
                avg7Holo: safeNum(price["avg7-holo"]),
                avg30Holo: safeNum(price["avg30-holo"]),
              }
            : null,
        };
      })
      .sort((a, b) => {
        const aPrice = a.effectivePrice ?? -1;
        const bPrice = b.effectivePrice ?? -1;
        if (bPrice !== aPrice) return bPrice - aPrice;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);

    return NextResponse.json({
      ok: true,
      query,
      paths: {
        products: PRODUCTS_PATH,
        priceGuide: PRICEGUIDE_PATH,
      },
      files: {
        productsCount: products.length,
        priceGuideCount: priceGuides.length,
        productsCreatedAt: productsFile.createdAt ?? null,
        priceGuideCreatedAt: priceFile.createdAt ?? null,
      },
      resultCount: matches.length,
      matches,
    });
  } catch (error: any) {
    console.error("[pokemon debug-cm-match] failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Internal error",
        paths: {
          products: PRODUCTS_PATH,
          priceGuide: PRICEGUIDE_PATH,
        },
      },
      { status: 500 }
    );
  }
}