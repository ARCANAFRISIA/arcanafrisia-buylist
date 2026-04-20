import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const maxDuration = 300; // Vercel-friendly
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SCRYFALL_BASE = "https://api.scryfall.com/cards/cardmarket";
const SCRYFALL_SEARCH = "https://api.scryfall.com/cards/search";

type SFResp = {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  collector_number?: string;
  lang?: string;
  image_uris?: { small?: string; normal?: string };
  card_faces?: { image_uris?: { small?: string; normal?: string } }[];
  rarity?: string;
  prices?: {
    usd?: string | null;
    eur?: string | null;
    tix?: string | null;
  };
  edhrec_rank?: number;
  legalities?: Record<string, string>;
  game_changer?: boolean;
  released_at?: string;
};

type SFListResp = {
  object: "list";
  has_more?: boolean;
  next_page?: string;
  data: SFResp[];
};

type FetchOk = { ok: true; data: SFResp };
type FetchErr = { ok: false; code: number; body?: string };
type FetchResult = FetchOk | FetchErr;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parsePrice(x?: string | null): number | null {
  if (!x) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function extractImages(data: SFResp) {
  const imgSmall =
    data.image_uris?.small ?? data.card_faces?.[0]?.image_uris?.small ?? null;

  const imgNormal =
    data.image_uris?.normal ?? data.card_faces?.[0]?.image_uris?.normal ?? null;

  return { imgSmall, imgNormal };
}

function nextBackoffMs(attemptsSoFar: number): number {
  // 5m, 10m, 20m, 40m, max 60m
  const minutes = Math.min(60, 5 * Math.pow(2, Math.max(0, attemptsSoFar)));
  return minutes * 60 * 1000;
}

async function fetchOne(cardmarketId: number): Promise<FetchResult> {
  const res = await fetch(`${SCRYFALL_BASE}/${cardmarketId}`, {
    cache: "no-store",
  });

  if (res.status === 404) {
    return {
      ok: false,
      code: 404,
      body: await res.text().catch(() => ""),
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      code: res.status,
      body: await res.text().catch(() => ""),
    };
  }

  const data = (await res.json()) as SFResp;
  return { ok: true, data };
}

type OraclePriceFallback = {
  eur: number | null;
  tix: number | null;
  usd: number | null;
  fromSet: string | null;
  fromScryfallId: string | null;
};

const oraclePriceCache = new Map<string, OraclePriceFallback | null>();

function scorePrintForPriceFallback(card: SFResp): number {
  let score = 0;

  const eur = parsePrice(card.prices?.eur);
  const tix = parsePrice(card.prices?.tix);
  const usd = parsePrice(card.prices?.usd);

  if (eur != null) score += 1000;
  if (tix != null) score += 300;
  if (usd != null) score += 100;

  // echte paper/mtgo normale prints zijn vaak bruikbaarder dan rare variants,
  // maar we houden het simpel en leunen vooral op prijs-aanwezigheid
  if (card.set && !card.set.startsWith("p")) score += 10;
  if (card.released_at) score += 1;

  return score;
}

async function fetchOraclePriceFallback(
  oracleId: string
): Promise<OraclePriceFallback | null> {
  if (oraclePriceCache.has(oracleId)) {
    return oraclePriceCache.get(oracleId) ?? null;
  }

  const url =
    `${SCRYFALL_SEARCH}?order=released` +
    `&q=${encodeURIComponent(`oracleid:${oracleId}`)}` +
    `&unique=prints`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Oracle fallback failed for ${oracleId}: HTTP ${res.status}${
        text ? ` - ${text.slice(0, 300)}` : ""
      }`
    );
  }

  const json = (await res.json()) as SFListResp;
  const prints = Array.isArray(json.data) ? json.data : [];

  if (prints.length === 0) {
    oraclePriceCache.set(oracleId, null);
    return null;
  }

  const candidates = prints
    .map((card) => ({
      card,
      eur: parsePrice(card.prices?.eur),
      tix: parsePrice(card.prices?.tix),
      usd: parsePrice(card.prices?.usd),
      score: scorePrintForPriceFallback(card),
    }))
    .filter((x) => x.eur != null || x.tix != null || x.usd != null)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    oraclePriceCache.set(oracleId, null);
    return null;
  }

  const best = candidates[0];
  const picked: OraclePriceFallback = {
    eur: best.eur,
    tix: best.tix,
    usd: best.usd,
    fromSet: best.card.set ?? null,
    fromScryfallId: best.card.id ?? null,
  };

  oraclePriceCache.set(oracleId, picked);
  return picked;
}

async function enrichWithOraclePriceFallback(data: SFResp): Promise<SFResp> {
  const hasDirectTix = parsePrice(data.prices?.tix) != null;
  const hasDirectUsd = parsePrice(data.prices?.usd) != null;

  // Voor EUR doen we GEEN oracle fallback:
  // EUR moet print-specifiek blijven.
  if (hasDirectTix && hasDirectUsd) {
    return data;
  }

  if (!data.oracle_id) {
    return data;
  }

  const fallback = await fetchOraclePriceFallback(data.oracle_id);
  if (!fallback) {
    return data;
  }

  return {
    ...data,
    prices: {
      usd:
        hasDirectUsd
          ? data.prices?.usd ?? null
          : fallback.usd != null
          ? String(fallback.usd)
          : null,

      // BELANGRIJK:
      // EUR blijft exact zoals de directe print hem teruggeeft
      eur: data.prices?.eur ?? null,

      tix:
        hasDirectTix
          ? data.prices?.tix ?? null
          : fallback.tix != null
          ? String(fallback.tix)
          : null,
    },
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const batch = Math.max(1, Number(url.searchParams.get("batch") ?? 120));
  const conc = Math.max(1, Number(url.searchParams.get("concurrency") ?? 8));

  const now = new Date();

  const jobs = await prisma.scryfallLookupQueue.findMany({
    where: {
      notFound: false,
      attempts: { lte: 3 },
      OR: [{ nextTryAt: null }, { nextTryAt: { lte: now } }],
    },
    orderBy: { id: "asc" },
    take: batch,
  });

  if (jobs.length === 0) {
    const queueReady = await prisma.scryfallLookupQueue.count({
      where: {
        notFound: false,
        attempts: { lte: 3 },
        OR: [{ nextTryAt: null }, { nextTryAt: { lte: now } }],
      },
    });

    const queueWaiting = await prisma.scryfallLookupQueue.count({
      where: {
        notFound: false,
        attempts: { lte: 3 },
        nextTryAt: { gt: now },
      },
    });

    const queueFailed = await prisma.scryfallLookupQueue.count({
      where: {
        notFound: false,
        attempts: { gt: 3 },
      },
    });

    const queueNotFound = await prisma.scryfallLookupQueue.count({
      where: { notFound: true },
    });

    const totalLookup = await prisma.scryfallLookup.count();

    return NextResponse.json({
      status: "idle",
      processed: 0,
      queueReady,
      queueWaiting,
      queueFailed,
      queueNotFound,
      totalLookup,
      oraclePriceCacheSize: oraclePriceCache.size,
    });
  }

  const chunks: typeof jobs[] = [];
  for (let i = 0; i < jobs.length; i += conc) {
    chunks.push(jobs.slice(i, i + conc));
  }

  let processed = 0;
  const toDelete: number[] = [];

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (job) => {
        try {
          const r = await fetchOne(job.cardmarketId);

          if (!r.ok) {
            if (r.code === 404) {
              await prisma.scryfallLookupQueue.update({
                where: { id: job.id },
                data: {
                  notFound: true,
                  lastError: "404 Not Found",
                  processedAt: new Date(),
                  nextTryAt: null,
                },
              });

              return { del: false, jobId: job.id };
            }

            const nextTryAt = new Date(
              Date.now() + nextBackoffMs(job.attempts)
            );

            const errorText = `HTTP ${r.code}${
              r.body ? ` - ${r.body.slice(0, 300)}` : ""
            }`;

            await prisma.scryfallLookupQueue.update({
              where: { id: job.id },
              data: {
                attempts: { increment: 1 },
                lastError: errorText,
                nextTryAt,
              },
            });

            return { del: false, jobId: job.id };
          }

          const enriched = await enrichWithOraclePriceFallback(r.data);
          const { imgSmall, imgNormal } = extractImages(enriched);
          const rarity = enriched.rarity ?? null;

          await prisma.scryfallLookup.upsert({
            where: { cardmarketId: job.cardmarketId },
            create: {
              cardmarketId: job.cardmarketId,
              scryfallId: enriched.id,
              oracleId: enriched.oracle_id ?? null,
              name: enriched.name,
              set: enriched.set,
              collectorNumber: enriched.collector_number ?? null,
              lang: enriched.lang ?? null,
              imageSmall: imgSmall,
              imageNormal: imgNormal,
              rarity,
              usd: parsePrice(enriched.prices?.usd),
              eur: parsePrice(enriched.prices?.eur),
              tix: parsePrice(enriched.prices?.tix),
              edhrecRank: enriched.edhrec_rank ?? null,
              legalities:
                enriched.legalities != null
                  ? (enriched.legalities as Prisma.InputJsonValue)
                  : Prisma.DbNull,
              gameChanger: enriched.game_changer ?? null,
            },
            update: {
              scryfallId: enriched.id,
              oracleId: enriched.oracle_id ?? null,
              name: enriched.name,
              set: enriched.set,
              collectorNumber: enriched.collector_number ?? null,
              lang: enriched.lang ?? null,
              imageSmall: imgSmall,
              imageNormal: imgNormal,
              rarity,
              usd: parsePrice(enriched.prices?.usd),
              eur: parsePrice(enriched.prices?.eur),
              tix: parsePrice(enriched.prices?.tix),
              edhrecRank: enriched.edhrec_rank ?? null,
              legalities:
                enriched.legalities != null
                  ? (enriched.legalities as Prisma.InputJsonValue)
                  : Prisma.DbNull,
              gameChanger: enriched.game_changer ?? null,
            },
          });

          return { del: true, jobId: job.id };
        } catch (e: any) {
          const nextTryAt = new Date(
            Date.now() + nextBackoffMs(job.attempts)
          );

          await prisma.scryfallLookupQueue.update({
            where: { id: job.id },
            data: {
              attempts: { increment: 1 },
              lastError: String(e?.message || e).slice(0, 500),
              nextTryAt,
            },
          });

          return { del: false, jobId: job.id };
        }
      })
    );

    for (const r of results) {
      if (r.del) toDelete.push(r.jobId);
    }

    processed += chunk.length;
    await sleep(150);
  }

  if (toDelete.length) {
    await prisma.scryfallLookupQueue.deleteMany({
      where: { id: { in: toDelete } },
    });
  }

  const queueReady = await prisma.scryfallLookupQueue.count({
    where: {
      notFound: false,
      attempts: { lte: 3 },
      OR: [{ nextTryAt: null }, { nextTryAt: { lte: new Date() } }],
    },
  });

  const queueWaiting = await prisma.scryfallLookupQueue.count({
    where: {
      notFound: false,
      attempts: { lte: 3 },
      nextTryAt: { gt: new Date() },
    },
  });

  const queueFailed = await prisma.scryfallLookupQueue.count({
    where: {
      notFound: false,
      attempts: { gt: 3 },
    },
  });

  const queueNotFound = await prisma.scryfallLookupQueue.count({
    where: { notFound: true },
  });

  const totalLookup = await prisma.scryfallLookup.count();

  return NextResponse.json({
    status: "processing",
    processed,
    queueReady,
    queueWaiting,
    queueFailed,
    queueNotFound,
    totalLookup,
    oraclePriceCacheSize: oraclePriceCache.size,
  });
}