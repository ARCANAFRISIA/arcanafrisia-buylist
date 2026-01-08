import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROW_CAPACITY = 900;
const DRAWER_PRIORITY_REGULAR = ["D","E","F","A","B","G","H","I","J"] as const;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseLoc(loc: string | null | undefined): { drawer: string; row: number; batch: number } | null {
  const s = (loc ?? "").trim();
  const m = s.match(/^([A-J])(\d{2})\.(\d{2})$/);
  if (!m) return null;
  return { drawer: m[1], row: Number(m[2]), batch: Number(m[3]) };
}

function rowKey(drawer: string, row: number) {
  return `${drawer}${pad2(row)}`; // e.g. D01
}

function allowedRowsRegular() {
  return DRAWER_PRIORITY_REGULAR.map((d) => ({ drawer: d, rows: [1,2,3,4,5,6] }));
}

async function getStockClassByCardmarketIds(cardmarketIds: number[]) {
  // cmid -> scryfallId
  const lookups = await prisma.scryfallLookup.findMany({
    where: { cardmarketId: { in: cardmarketIds } },
    select: { cardmarketId: true, scryfallId: true },
  });

  const scryByCmid = new Map<number, string>();
  const scryIds = new Set<string>();

  for (const l of lookups) {
    if (l.scryfallId) {
      scryByCmid.set(Number(l.cardmarketId), l.scryfallId);
      scryIds.add(l.scryfallId);
    }
  }

  // scryfallId -> stockClass
  const policies = await prisma.stockPolicy.findMany({
    where: { scryfallId: { in: Array.from(scryIds) } },
    select: { scryfallId: true, stockClass: true },
  });

  const classByScry = new Map<string, string>();
  for (const p of policies) classByScry.set(p.scryfallId, String(p.stockClass));

  // cmid -> stockClass (default REGULAR)
  const out = new Map<number, "CORE"|"COMMANDER"|"REGULAR"|"CTBULK">();
  for (const cmid of cardmarketIds) {
    const scry = scryByCmid.get(cmid);
    const sc = scry ? (classByScry.get(scry) as any) : null;
    out.set(cmid, (sc ?? "REGULAR") as any);
  }

  return out;
}

type State = {
  usedByRow: Map<string, number>; // rk -> qty
  maxBatchByRow: Map<string, number>; // rk -> max batch
  batchByRowAndSource: Map<string, number>; // rk|source -> batch
};

function buildStateFromExistingLots(lots: { location: string | null; qtyRemaining: number; sourceCode: string }[]): State {
  const usedByRow = new Map<string, number>();
  const maxBatchByRow = new Map<string, number>();
  const batchByRowAndSource = new Map<string, number>();

  for (const l of lots) {
    const p = parseLoc(l.location);
    if (!p) continue;

    const rk = rowKey(p.drawer, p.row);
    usedByRow.set(rk, (usedByRow.get(rk) ?? 0) + Number(l.qtyRemaining ?? 0));
    maxBatchByRow.set(rk, Math.max(maxBatchByRow.get(rk) ?? 0, p.batch));

    const src = (l.sourceCode ?? "UNKNOWN").trim() || "UNKNOWN";
    const key = `${rk}|${src}`;
    const existing = batchByRowAndSource.get(key);
    if (existing == null || p.batch < existing) batchByRowAndSource.set(key, p.batch);
  }

  return { usedByRow, maxBatchByRow, batchByRowAndSource };
}

function allocateRegular(state: State, sourceCode: string) {
  const groups = allowedRowsRegular();
  const src = (sourceCode ?? "UNKNOWN").trim() || "UNKNOWN";

  for (const g of groups) {
    for (const r of g.rows) {
      const rk = rowKey(g.drawer, r);
      const used = state.usedByRow.get(rk) ?? 0;
      if (used >= ROW_CAPACITY) continue;

      const sourceKey = `${rk}|${src}`;
      const existingBatch = state.batchByRowAndSource.get(sourceKey);
      const batch = existingBatch ?? Math.min(99, (state.maxBatchByRow.get(rk) ?? 0) + 1);
      if (batch < 1 || batch > 99) continue;

      return { location: `${g.drawer}${pad2(r)}.${pad2(batch)}`, rk, batch, src };
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(20000, Math.max(1, Number(url.searchParams.get("limit") || "2000")));
    const dryRun = url.searchParams.get("dryRun") === "1";

    // 1) fetch missing lots (ids + basics)
    const missing = await prisma.inventoryLot.findMany({
      where: { qtyRemaining: { gt: 0 }, OR: [{ location: null }, { location: "" }] },
      select: { id: true, cardmarketId: true, qtyRemaining: true, sourceCode: true },
      take: limit,
      orderBy: [{ createdAt: "asc" }],
    });

    if (!missing.length) {
      return NextResponse.json({ ok: true, updated: 0, dryRun, message: "no missing locations" });
    }

    // 2) load existing lots with location once
    const existingLots = await prisma.inventoryLot.findMany({
      where: { qtyRemaining: { gt: 0 }, location: { not: null } },
      select: { location: true, qtyRemaining: true, sourceCode: true },
    });

    const state = buildStateFromExistingLots(
      existingLots.map((l) => ({
        location: l.location,
        qtyRemaining: Number(l.qtyRemaining ?? 0),
        sourceCode: (l.sourceCode ?? "UNKNOWN") as any,
      }))
    );

    // 3) stockClass map in bulk
    const cmids = Array.from(new Set(missing.map((m) => Number(m.cardmarketId)).filter(Number.isFinite)));
    const classByCmid = await getStockClassByCardmarketIds(cmids);

    // 4) allocate + apply in batches (transaction per batch for speed)
    const errors: { lotId: string; message: string }[] = [];
    const updates: { id: string; location: string }[] = [];

    for (const lot of missing) {
      const cmid = Number(lot.cardmarketId);
      const sc = classByCmid.get(cmid) ?? "REGULAR";

      // ✅ HOLDING: CORE/COMMANDER behandelen als REGULAR voor backfill
      const holding = sc === "CORE" || sc === "COMMANDER" ? "REGULAR" : sc;

      // CTBULK/REGULAR delen zelfde fysieke range → regular allocator
      if (holding !== "REGULAR" && holding !== "CTBULK") {
        // safety
      }

      const alloc = allocateRegular(state, lot.sourceCode ?? "UNKNOWN");
      if (!alloc) {
        errors.push({ lotId: lot.id, message: "no location capacity available (regular ranges)" });
        continue;
      }

      // update state in-memory so next allocations see updated usage
      state.usedByRow.set(alloc.rk, (state.usedByRow.get(alloc.rk) ?? 0) + Number(lot.qtyRemaining ?? 0));
      state.maxBatchByRow.set(alloc.rk, Math.max(state.maxBatchByRow.get(alloc.rk) ?? 0, alloc.batch));
      state.batchByRowAndSource.set(`${alloc.rk}|${alloc.src}`, alloc.batch);

      updates.push({ id: lot.id, location: alloc.location });
    }

    if (!dryRun && updates.length) {
      // apply in chunks to avoid giant transaction
      const CHUNK = 500;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const chunk = updates.slice(i, i + CHUNK);
        await prisma.$transaction(
          chunk.map((u) =>
            prisma.inventoryLot.update({
              where: { id: u.id },
              data: { location: u.location },
              select: { id: true },
            })
          )
        );
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      scanned: missing.length,
      updated: updates.length,
      errors,
      note: "CORE/COMMANDER are backfilled into REGULAR holding ranges; use worklist to move them to C rows.",
    });
  } catch (e: any) {
    console.error("backfill-missing error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
