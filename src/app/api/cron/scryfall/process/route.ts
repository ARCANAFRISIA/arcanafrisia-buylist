import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";


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
  edhrec_rank?: number;
  legalities?: Record<string, string>;
  game_changer?: boolean;
};

type FetchOk = { ok: true; data: SFResp };
type FetchErr = { ok: false; code: number };
type FetchResult = FetchOk | FetchErr;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));


function parsePrice(x?: string | null): number | null {
  if (!x) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

async function fetchOne(cardmarketId: number): Promise<FetchResult> {
  const res = await fetch(`${SCRYFALL_BASE}/${cardmarketId}`, { cache: "no-store" });
  if (res.status === 404) return { ok: false, code: 404 };   // definitief: bestaat niet
  if (!res.ok) return { ok: false, code: res.status };       // tijdelijk: 429/500/etc.
  const data = await res.json() as SFResp;
  return { ok: true, data };
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
      const r = await fetchOne(job.cardmarketId);

      if (!r.ok) {
        if (r.code === 404) {
          // markeer definitief niet-bestaand en verwijder uit queue
          await prisma.scryfallLookupQueue.update({
            where: { id: job.id },
            data: { notFound: true, lastError: "404 Not Found", processedAt: new Date() }
          });
          return { del: true, jobId: job.id };
        } else {
          // tijdelijke fout: retry later
          await prisma.scryfallLookupQueue.update({
            where: { id: job.id },
            data: {
              attempts: { increment: 1 },
              lastError: `HTTP ${r.code}`,
              nextTryAt: new Date(Date.now() + 15 * 60 * 1000) // 15min backoff
            }
          });
          return { retry: true, jobId: job.id };
        }
      }

      const data = r.data;

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
          edhrecRank: data.edhrec_rank ?? null,
          legalities: {
  set:
    data.legalities !== undefined && data.legalities !== null
      ? (data.legalities as Prisma.JsonValue)
      : null
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
          imageSmall: data.image_uris?.small ?? null,
          imageNormal: data.image_uris?.normal ?? null,
          usd: parsePrice(data.prices?.usd) ?? null,
          eur: parsePrice(data.prices?.eur) ?? null,
          tix: parsePrice(data.prices?.tix) ?? null,
          edhrecRank: data.edhrec_rank ?? null,
          legalities: {
  set:
    data.legalities !== undefined && data.legalities !== null
      ? (data.legalities as Prisma.JsonValue)
      : null
},

          gameChanger: data.game_changer ?? null,
        },
      });

      return { del: true, ok: true, jobId: job.id };

    } catch (e: any) {
      // netwerk/exception → retry
      await prisma.scryfallLookupQueue.update({
        where: { id: job.id },
        data: {
          attempts: { increment: 1 },
          lastError: String(e?.message || e),
          nextTryAt: new Date(Date.now() + 15 * 60 * 1000)
        }
      });
      return { retry: true, jobId: job.id };
    }
  })
);

// opruimen zoals je had
for (const r of results) {
  if ((r as any).del) toDelete.push((r as any).jobId);
  else if ((r as any).retry) toRetry.push((r as any).jobId);
}

processed += chunk.length;

// kleine pauze om rate-limit te respecteren
await sleep(150);

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
