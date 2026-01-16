import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BATCH = 70;

async function batchUpdateTcgplayerId(pairs: Array<{ cardmarketId: number; tcgplayerId: number }>) {
  if (!pairs.length) return 0;

  // Build: UPDATE ... SET tcgplayerId = CASE cardmarketId WHEN ... END WHERE cardmarketId IN (...)
  const ids = pairs.map((p) => p.cardmarketId);

  const caseParts: string[] = [];
  const params: any[] = [];

  // params: [tcg1, id1, tcg2, id2, ... , ...ids]
  let idx = 1;
  for (const p of pairs) {
    params.push(p.cardmarketId);
    params.push(p.tcgplayerId);
    // cardmarketId param idx, tcg param idx+1
    caseParts.push(`WHEN $${idx} THEN $${idx + 1}`);
    idx += 2;
  }

  // Now ids list parameters
  const inParams: string[] = [];
  for (const id of ids) {
    params.push(id);
    inParams.push(`$${idx}`);
    idx += 1;
  }

  const sql = `
    UPDATE "ScryfallLookup"
    SET "tcgplayerId" = CASE "cardmarketId"
      ${caseParts.join("\n      ")}
      ELSE "tcgplayerId"
    END,
    "updatedAt" = now()
    WHERE "cardmarketId" IN (${inParams.join(",")})
  `;

  const res = await prisma.$executeRawUnsafe(sql, ...params);
  return Number(res) || 0;
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(5000, Number(body?.limit ?? 1000)));

    const rows = await prisma.scryfallLookup.findMany({
      where: { tcgplayerId: null },
      select: { cardmarketId: true, scryfallId: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });

    if (!rows.length) {
      return NextResponse.json({ ok: true, message: "nothing to backfill", scanned: 0, updated: 0 });
    }

    let updated = 0;
    const errors: { cardmarketId: number; scryfallId: string; error: string }[] = [];

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const identifiers = batch.map((r) => ({ id: r.scryfallId }));

      let payload: any;
      try {
        const res = await fetch("https://api.scryfall.com/cards/collection", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "ArcanaFrisia/1.0 (buylist)",
          },
          body: JSON.stringify({ identifiers }),
          cache: "no-store",
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`collection ${res.status}: ${txt.slice(0, 200)}`);
        }
        payload = await res.json();
      } catch (e: any) {
        for (const r of batch) {
          errors.push({
            cardmarketId: r.cardmarketId,
            scryfallId: r.scryfallId,
            error: String(e?.message || e),
          });
        }
        continue;
      }

      const cards: any[] = Array.isArray(payload?.data) ? payload.data : [];
      const byId = new Map<string, any>();
      for (const c of cards) if (c?.id) byId.set(String(c.id), c);

      const pairs: Array<{ cardmarketId: number; tcgplayerId: number }> = [];

for (const r of batch) {
  const c = byId.get(r.scryfallId);
  const tcg = c?.tcgplayer_id ?? null;
  if (tcg == null) continue;
  pairs.push({ cardmarketId: r.cardmarketId, tcgplayerId: Number(tcg) });
}

const changed = await batchUpdateTcgplayerId(pairs);
updated += changed;

    }

    return NextResponse.json({
      ok: true,
      scanned: rows.length,
      updated,
      errorsCount: errors.length,
      errors: errors.slice(0, 50),
    });
  } catch (e: any) {
    console.error("backfill tcgplayer error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
