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
type FetchErr = { ok: false; code: number };
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

async function fetchOne(cardmarketId: number): Promise<FetchResult> {
  const res = await fetch(`${SCRYFALL_BASE}/${cardmarketId}`, { cache: "no-store" });
  if (res.status === 404) return { ok: false, code: 404 }; // definitief
  if (!res.ok) return { ok: false, code: res.status };    // tijdelijk
  const data = (await res.json()) as SFResp;
  return { ok: true, data };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const batch = Number(url.searchParams.get("batch") ?? 120);
  const conc = Number(url.searchParams.get("concurrency") ?? 8);

  const now = new Date();

  // ✅ Pak alleen jobs die echt "ready" zijn (backoff respecteren)
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
    const remainingReady = await prisma.scryfallLookupQueue.count({
      where: {
        notFound: false,
        attempts: { lte: 3 },
        OR: [{ nextTryAt: null }, { nextTryAt: { lte: now } }],
      },
    });
    const remainingAll = await prisma.scryfallLookupQueue.count();
    const total = await prisma.scryfallLookup.count();
    return NextResponse.json({
      status: "idle",
      processed: 0,
      remainingQueueReady: remainingReady,
      remainingQueueAll: remainingAll,
      total,
    });
  }

  const chunks: typeof jobs[] = [];
  for (let i = 0; i < jobs.length; i += conc) chunks.push(jobs.slice(i, i + conc));

  let processed = 0;
  const toDelete: number[] = [];

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (job) => {
        try {
          const r = await fetchOne(job.cardmarketId);

          if (!r.ok) {
            if (r.code === 404) {
              // ✅ definitief: markeer en haal uit queue
              await prisma.scryfallLookupQueue.update({
                where: { id: job.id },
                data: {
                  notFound: true,
                  lastError: "404 Not Found",
                  processedAt: new Date(),
                  nextTryAt: null,
                },
              });
              return { del: true, jobId: job.id };
            }

            // ✅ tijdelijk: backoff + attempts + later retry
            await prisma.scryfallLookupQueue.update({
              where: { id: job.id },
              data: {
                attempts: { increment: 1 },
                lastError: `HTTP ${r.code}`,
                nextTryAt: new Date(Date.now() + 15 * 60 * 1000),
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
              legalities: {
                set:
                  data.legalities !== undefined && data.legalities !== null
                    ? (data.legalities as Prisma.JsonValue)
                    : null,
              },
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
              legalities: {
                set:
                  data.legalities !== undefined && data.legalities !== null
                    ? (data.legalities as Prisma.JsonValue)
                    : null,
              },
              gameChanger: data.game_changer ?? null,
            },
          });

          return { del: true, jobId: job.id };
        } catch (e: any) {
          // ✅ exception/netwerk: backoff + attempts
          await prisma.scryfallLookupQueue.update({
            where: { id: job.id },
            data: {
              attempts: { increment: 1 },
              lastError: String(e?.message || e),
              nextTryAt: new Date(Date.now() + 15 * 60 * 1000),
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

  // ✅ verwijder successen + 404-definitief uit queue
  if (toDelete.length) {
    await prisma.scryfallLookupQueue.deleteMany({ where: { id: { in: toDelete } } });
  }

  // ✅ drop jobs die te vaak gefaald hebben
  await prisma.scryfallLookupQueue.deleteMany({
    where: { attempts: { gt: 3 } },
  });

  const remainingReady = await prisma.scryfallLookupQueue.count({
    where: {
      notFound: false,
      attempts: { lte: 3 },
      OR: [{ nextTryAt: null }, { nextTryAt: { lte: new Date() } }],
    },
  });
  const remainingAll = await prisma.scryfallLookupQueue.count();
  const total = await prisma.scryfallLookup.count();

  return NextResponse.json({
    status: "processing",
    processed,
    remainingQueueReady: remainingReady,
    remainingQueueAll: remainingAll,
    total,
  });
}
