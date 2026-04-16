import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const maxDuration = 300; // Vercel-friendly
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SCRYFALL_BASE = "https://api.scryfall.com/cards/cardmarket";

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
  prices?: { usd?: string | null; eur?: string | null; tix?: string | null };
  edhrec_rank?: number;
  legalities?: Record<string, string>;
  game_changer?: boolean;
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
  // 5m, 10m, 20m, max 60m
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const batch = Math.max(1, Number(url.searchParams.get("batch") ?? 120));
  const conc = Math.max(1, Number(url.searchParams.get("concurrency") ?? 8));

  const now = new Date();

  // Alleen actieve jobs:
  // - niet notFound
  // - nog binnen retry-limit
  // - ready qua backoff
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
              // Definitieve miss:
              // bewaren in queue als notFound voor inzicht/debugging
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

            // Tijdelijke fout: retry met backoff
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

          const data = r.data;
          const { imgSmall, imgNormal } = extractImages(data);
          const rarity = data.rarity ?? null;

          await prisma.scryfallLookup.upsert({
            where: { cardmarketId: job.cardmarketId },
            create: {
              cardmarketId: job.cardmarketId,
              scryfallId: data.id,
              oracleId: data.oracle_id ?? null,
              name: data.name,
              set: data.set,
              collectorNumber: data.collector_number ?? null,
              lang: data.lang ?? null,
              imageSmall: imgSmall,
              imageNormal: imgNormal,
              rarity,
              usd: parsePrice(data.prices?.usd),
              eur: parsePrice(data.prices?.eur),
              tix: parsePrice(data.prices?.tix),
              edhrecRank: data.edhrec_rank ?? null,
         legalities:
  data.legalities != null
    ? (data.legalities as Prisma.InputJsonValue)
    : Prisma.DbNull,
              gameChanger: data.game_changer ?? null,
            },
            update: {
              scryfallId: data.id,
              oracleId: data.oracle_id ?? null,
              name: data.name,
              set: data.set,
              collectorNumber: data.collector_number ?? null,
              lang: data.lang ?? null,
              imageSmall: imgSmall,
              imageNormal: imgNormal,
              rarity,
              usd: parsePrice(data.prices?.usd),
              eur: parsePrice(data.prices?.eur),
              tix: parsePrice(data.prices?.tix),
              edhrecRank: data.edhrec_rank ?? null,
         legalities:
  data.legalities != null
    ? (data.legalities as Prisma.InputJsonValue)
    : Prisma.DbNull,
              gameChanger: data.game_changer ?? null,
            },
          });

          // Succes: job uit queue verwijderen
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

  // Alleen successen uit queue halen
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
  });
}