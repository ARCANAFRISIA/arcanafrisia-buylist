import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

function normalizeCMId(raw: any): number | null {
  if (raw == null) return null;
  if (Array.isArray(raw) && raw.length) return normalizeCMId(raw[0]); // neem 1e
  const s = String(raw).trim();              // "12345.0" → "12345"
  const m = s.match(/^\d+/);
  if (m) return Number(m[0]);
  if (typeof raw === "number" && isFinite(raw)) return Math.trunc(raw);
  return null;
}


const HOST = process.env.CT_HOST!;
const TOKEN = process.env.CT_TOKEN!;
const MTG_GAME_ID = 1;

async function j(url: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`);
  return r.json();
}

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    if (!HOST || !TOKEN) throw new Error("CT_HOST/CT_TOKEN missing in env");

    // 1) alle expansions
    const exps: any[] = await j(`${HOST}/api/v2/expansions`);

    let setsTried = 0, blueprintsWritten = 0, setsSkipped = 0;

    for (const e of exps) {
      // filter op MTG waar mogelijk
      if (e?.game_id && e.game_id !== MTG_GAME_ID) { setsSkipped++; continue; }

      let bps: any[] = [];
      try {
        bps = await j(`${HOST}/api/v2/blueprints/export?expansion_id=${e.id}`);
      } catch {
        setsSkipped++;
        continue;
      }
      if (!Array.isArray(bps) || bps.length === 0) { setsSkipped++; continue; }

      setsTried++;

      for (const b of bps) {
        const cmId =
  normalizeCMId(b.cardmarket_id) ??
  normalizeCMId(b.mkm_id) ??
  normalizeCMId(b.cardmarketIds) ??
  normalizeCMId(b.cardmarket_ids);

        await prisma.blueprintMapping.upsert({
  where: { blueprintId: Number(b.id) },
  update: {
    expansionId: Number(e.id),
    name: b.name ?? null,
    collectorNumber: b.collector_number ?? null,
    cardmarketId: cmId,                 // ← hier
    scryfallId: b.scryfall_id ?? null,
    updatedAt: new Date(),      
  },
  create: {
    blueprintId: Number(b.id),
    expansionId: Number(e.id),
    name: b.name ?? null,
    collectorNumber: b.collector_number ?? null,
    cardmarketId: cmId,                 // ← en hier
    scryfallId: b.scryfall_id ?? null,
    updatedAt: new Date(), 
  },
});

        blueprintsWritten++;
      }
    }

    return NextResponse.json({
      ok: true,
      setsTried,
      setsSkipped,
      blueprintsWritten,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
