import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const HOST = process.env.CT_HOST!;
const TOKEN = process.env.CT_TOKEN!;
const MTG_GAME_ID = 1;

function normalizeCMId(raw: any): number | null {
  if (raw == null) return null;
  if (Array.isArray(raw) && raw.length) return normalizeCMId(raw[0]);
  const s = String(raw).trim();
  const m = s.match(/^\d+/);
  if (m) return Number(m[0]);
  if (typeof raw === "number" && isFinite(raw)) return Math.trunc(raw);
  return null;
}

async function j(url: string, timeoutMs = 30000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: controller.signal,
    cache: "no-store",
  });
  clearTimeout(t);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`);
  return r.json();
}

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!HOST || !TOKEN) throw new Error("CT_HOST/CT_TOKEN missing");

    const { searchParams } = new URL(req.url);
    const oneExpansionId = searchParams.get("expansion_id");      // bv. ?expansion_id=1
    const offset = Number(searchParams.get("offset") ?? "0");      // bv. ?offset=0&limit=2
    const limit  = Math.min(Number(searchParams.get("limit") ?? "1"), 10);
    const limitBlueprints = Number(searchParams.get("limit_blueprints") ?? "0"); // 0 = geen limiet

    // 1) Haal expansions op
    const allExps: any[] = await j(`${HOST}/api/v2/expansions`);
    const mtg = (allExps || []).filter(e => !e.game_id || e.game_id === MTG_GAME_ID);

    // Kies welke we nu doen
    let targets: any[] = [];
    if (oneExpansionId) {
      const idNum = Number(oneExpansionId);
      const found = mtg.find(e => Number(e.id) === idNum);
      if (!found) return NextResponse.json({ ok:false, error:`Expansion ${idNum} not found` }, { status: 404 });
      targets = [found];
    } else {
      targets = mtg.slice(offset, offset + limit);
    }

    let setsTried = 0, setsSkipped = 0, blueprintsWritten = 0;

    for (const e of targets) {
      try {
        const url = `${HOST}/api/v2/blueprints/export?expansion_id=${e.id}`;
        const bps: any[] = await j(url, 90000); // 90s per set
        if (!Array.isArray(bps) || bps.length === 0) { setsSkipped++; continue; }

        setsTried++;
        const slice = limitBlueprints > 0 ? bps.slice(0, limitBlueprints) : bps;

        // Upsert per blueprint
        for (const b of slice) {
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
              cardmarketId: cmId,
              scryfallId: b.scryfall_id ?? null,
              updatedAt: new Date(),
            },
            create: {
              blueprintId: Number(b.id),
              expansionId: Number(e.id),
              name: b.name ?? null,
              collectorNumber: b.collector_number ?? null,
              cardmarketId: cmId,
              scryfallId: b.scryfall_id ?? null,
              updatedAt: new Date(),
            },
          });
          blueprintsWritten++;
        }
      } catch {
        setsSkipped++;
      }
    }

    return NextResponse.json({
      ok: true,
      mode: oneExpansionId ? "single" : "paged",
      offset,
      limit,
      setsTried,
      setsSkipped,
      blueprintsWritten,
      next: oneExpansionId ? null : { offset: offset + limit, limit },
    });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}
