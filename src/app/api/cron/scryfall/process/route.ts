import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const maxDuration = 300; // Vercel-friendly

const SCRYFALL_BASE = "https://api.scryfall.com/cards/cardmarket";

type SFResp = {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  collector_number?: string;
  lang?: string;
  image_uris?: { small?: string; normal?: string };
  prices?: { usd?: string | null; eur?: string | null; tix?: string | null };
};

function parsePrice(x?: string | null): number | null {
  if (!x) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

async function fetchOne(cardmarketId: number): Promise<SFResp | null> {
  const res = await fetch(`${SCRYFALL_BASE}/${cardmarketId}`, { cache: "no-store" });
  if (res.status === 404) return null; // bestaat niet op Scryfall
  if (!res.ok) {
    throw new Error(`Scryfall ${res.status} for ${cardmarketId}`);
  }
  return res.json();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const batch = Number(url.searchParams.get("batch") ?? 80);  // hou dit <= ~100 (rate limit ~10/s)
  const conc  = Number(url.searchParams.get("concurrency") ?? 6); // parallel fetches

  // Pak oudste queue
  const jobs = await prisma.scryfallLookupQueue.findMany({
    orderBy: { id: "asc" },
    take: batch,
  });

  if (jobs.length === 0) {
    const remaining = await prisma.scryfallLookupQueue.count();
    const total = await prisma.scryfallLookup.count();
    return NextResponse.json({ status: "idle", processed: 0, remainingQueue: remaining, total });
  }

  const chunks: typeof jobs[] = [];
  for (let i = 0; i < jobs.length; i += conc) chunks.push(jobs.slice(i, i + conc));

  let processed = 0;
  const toDelete: number[] = [];
  const toRetry: number[] = [];

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async job => {
        try {
          const data = await fetchOne(job.cardmarketId);
          if (!data) {
            // niet gevonden -> weg uit queue
            return { jobId: job.id, del: true };
          }

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
              imageSmall: data.image_uris?.small ?? null,
              imageNormal: data.image_uris?.normal ?? null,
              rarity: null,
              usd: parsePrice(data.prices?.usd) ?? null,
              eur: parsePrice(data.prices?.eur) ?? null,
              tix: parsePrice(data.prices?.tix) ?? null,
            },
            update: {
              scryfallId: data.id,
              oracleId: data.oracle_id ?? null,
              name: data.name,
              set: data.set,
              collectorNumber: data.collector_number ?? null,
              lang: data.lang ?? null,
              imageSmall: data.image_uris?.small ?? null,
              imageNormal: data.image_uris?.normal ?? null,
              usd: parsePrice(data.prices?.usd) ?? null,
              eur: parsePrice(data.prices?.eur) ?? null,
              tix: parsePrice(data.prices?.tix) ?? null,
            },
          });

          return { jobId: job.id, del: true, ok: true };
        } catch (e) {
          // tijdelijke fout: één retry proberen in volgende run
          return { jobId: job.id, retry: true };
        }
      })
    );

    for (const r of results) {
      if (r.del) toDelete.push(r.jobId);
      else if (r.retry) toRetry.push(r.jobId);
    }

    processed += chunk.length;

    // kleine pauze tegen rate limits (ongeveer 6 parallel → ~6/s)
    await new Promise(r => setTimeout(r, 150));
  }

  // verwijder successen
  if (toDelete.length) {
    await prisma.scryfallLookupQueue.deleteMany({ where: { id: { in: toDelete } } });
  }

  // verhoog attempts voor retries (max 3; daarna droppen)
  if (toRetry.length) {
    await prisma.scryfallLookupQueue.updateMany({
      where: { id: { in: toRetry } },
      data: { attempts: { increment: 1 } },
    });
    await prisma.scryfallLookupQueue.deleteMany({
      where: { attempts: { gt: 3 }, id: { in: toRetry } },
    });
  }

  const remaining = await prisma.scryfallLookupQueue.count();
  const total = await prisma.scryfallLookup.count();
  return NextResponse.json({ status: "processing", processed, remainingQueue: remaining, total });
}
