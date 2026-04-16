import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const SETS = ["me1", "me2", "me3", "me4"] as const;

type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  collector_number?: string;
  lang?: string;
  rarity?: string;
  prices?: {
    usd?: string | null;
    eur?: string | null;
    tix?: string | null;
  };
};

type ScryfallListResponse = {
  object: "list";
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
};

function parsePrice(x?: string | null): number | null {
  if (!x) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

async function fetchAllForSet(setCode: string): Promise<ScryfallCard[]> {
  let url = `https://api.scryfall.com/cards/search?order=set&q=e%3A${encodeURIComponent(setCode)}&unique=prints`;
  const out: ScryfallCard[] = [];

  while (url) {
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Scryfall ${setCode} failed: HTTP ${res.status}${text ? ` - ${text.slice(0, 300)}` : ""}`);
    }

    const json = (await res.json()) as ScryfallListResponse;

    if (!Array.isArray(json.data)) {
      throw new Error(`Unexpected Scryfall response for ${setCode}`);
    }

    out.push(...json.data);
    url = json.has_more && json.next_page ? json.next_page : "";
  }

  return out;
}

export async function GET() {
  const summary: Array<{
    set: string;
    fetched: number;
    upserted: number;
    withTix: number;
  }> = [];

  let totalFetched = 0;
  let totalUpserted = 0;
  let totalWithTix = 0;

  for (const setCode of SETS) {
    const cards = await fetchAllForSet(setCode);

    let upserted = 0;
    let withTix = 0;

    for (const card of cards) {
      const tix = parsePrice(card.prices?.tix);
      const usd = parsePrice(card.prices?.usd);
      const eur = parsePrice(card.prices?.eur);

      if (tix !== null) withTix += 1;

      await prisma.scryfallTixFallback.upsert({
        where: { scryfallId: card.id },
        create: {
          scryfallId: card.id,
          oracleId: card.oracle_id ?? null,
          name: card.name,
          set: card.set,
          collectorNumber: card.collector_number ?? null,
          lang: card.lang ?? null,
          rarity: card.rarity ?? null,
          usd,
          eur,
          tix,
        },
        update: {
          oracleId: card.oracle_id ?? null,
          name: card.name,
          set: card.set,
          collectorNumber: card.collector_number ?? null,
          lang: card.lang ?? null,
          rarity: card.rarity ?? null,
          usd,
          eur,
          tix,
        },
      });

      upserted += 1;
    }

    totalFetched += cards.length;
    totalUpserted += upserted;
    totalWithTix += withTix;

    summary.push({
      set: setCode,
      fetched: cards.length,
      upserted,
      withTix,
    });
  }

  const totalRows = await prisma.scryfallTixFallback.count();

  return NextResponse.json({
    ok: true,
    sets: summary,
    totalFetched,
    totalUpserted,
    totalWithTix,
    totalRows,
  });
}