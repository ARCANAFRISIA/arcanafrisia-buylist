// src/app/api/cron/ct-refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMarketplaceByBlueprint, normalizeCTZeroOffers } from "@/lib/ct";
import { summarizeByBucket } from "@/lib/ctStats";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60; // Pro-plan

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const WORK_BUDGET_MS = 45_000;              // werk binnen 45s
  const timeLeft = () => Math.max(0, WORK_BUDGET_MS - (Date.now() - t0));

  const sp = req.nextUrl.searchParams;
  const debug = sp.get("debug") === "1";

  // Defaults
  const zeroMode: "pro" | "probe" | "none" = "pro";
  const allowedConds: Array<"NM" | "EX" | "GD"> = ["NM", "EX", "GD"];
  const lang: "en" | null = "en";
  const foil: boolean | null = null;

  // ====== Helpers ======
  async function processOne(bp: number) {
    // 1) CT marketplace fetchen
    const offers = await getMarketplaceByBlueprint(bp);

    // 2) Normaliseren & filteren
    const norm = await normalizeCTZeroOffers(offers, {
      zeroOnly: true,
      zeroMode: "pro",
      zeroProbeLimit: 8,
      allowedConds: ["NM", "EX", "GD"],
      lang: "en",
      foil: null,
    });

    // 3) Buckets
    const rowsNF   = summarizeByBucket(norm, false);
    const rowsFoil = summarizeByBucket(norm, true);
    const now = new Date();

    // 4) Mapping voor cardmarketId/scryfallId
    const map = await prisma.blueprintMapping.findUnique({
      where: { blueprintId: bp },
      select: { cardmarketId: true, scryfallId: true },
    });

    // 5) Writes (voorkom duplicate key errors)
    const data = [...rowsNF, ...rowsFoil].map(r => ({
  capturedAt: now,
  blueprintId: bp,
  cardmarketId: map?.cardmarketId ?? null,
  scryfallId:   map?.scryfallId   ?? null,
  bucket: r.bucket,
  isFoil: r.isFoil,
  minPrice: r.min ?? null,
  medianPrice: r.med ?? null,
  offerCount: r.count,
}));

await prisma.cTMarketSummary.createMany({
  data,
  skipDuplicates: true,   // dupes = stil overslaan
});
  }
}


  // ====== MODE A: Window (test) ======
  if (sp.get("limit")) {
    const limit  = Math.max(1, Number(sp.get("limit")));
    const offset = Math.max(0, Number(sp.get("offset") || 0));

    const ids = await prisma.blueprintMapping.findMany({
      select: { blueprintId: true },
      orderBy: { blueprintId: "asc" },
      skip: offset,
      take: limit,
    }).then(r => r.map(x => x.blueprintId));

    if (!ids.length) {
      return NextResponse.json({ status: "empty", message: "No ids in this window" }, { status: 200 });
    }

    let started = 0, ok = 0, fail = 0;
    for (const bp of ids) {
      if (timeLeft() < 1500) break;
      started++;
      try { await processOne(bp); ok++; }
      catch (e) { console.error("ct-refresh err@bp", bp, (e as Error)?.message || e); fail++; }
      await sleep(50); // mini-adempauze
    }

    const tookMs = Date.now() - t0;
    return NextResponse.json({
      status: "ok", mode: "window",
      window: { offset, limit },
      started, ok, fail,
      durationMs: tookMs, timeLeftMs: Math.max(0, WORK_BUDGET_MS - tookMs),
      debug
    }, { status: 200 });
  }

  // ====== MODE B: Cursor (cron) ======
  const total = await prisma.blueprintMapping.count();

  let cursor = await prisma.cTRefreshCursor.findUnique({ where: { id: 1 } });
  if (!cursor) {
    cursor = await prisma.cTRefreshCursor.create({ data: { id: 1, offset: 0, pageSize: 150 } });
  }

  const offset = Math.max(0, cursor.offset ?? 0);
  const pageSize = Math.max(50, Math.min(Number(sp.get("pageSize") ?? cursor.pageSize ?? 150), 300));

  const ids = await prisma.blueprintMapping.findMany({
    select: { blueprintId: true },
    orderBy: { blueprintId: "asc" },
    skip: offset,
    take: pageSize,
  }).then(r => r.map(x => x.blueprintId));

  if (!ids.length) {
    await prisma.cTRefreshCursor.update({ where: { id: 1 }, data: { offset: 0 } });
    return NextResponse.json({
      status: "ok", mode: "cursor",
      note: "Reached end; wrapped to 0. Nothing processed.",
      totalBlueprints: total, processedIds: 0, ok: 0, fail: 0,
      durationMs: Date.now() - t0
    }, { status: 200 });
  }

  // Tijd-geboxte verwerking
  let started = 0, ok = 0, fail = 0;
  for (const bp of ids) {
    if (timeLeft() < 1500) break;
    started++;
    try { await processOne(bp); ok++; }
    catch (e) { console.error("ct-refresh err@bp", bp, (e as Error)?.message || e); fail++; }
    await sleep(50);
  }

  // Cursor vooruit met werkelijk gestarte items
  const advancedBy = Math.min(started, ids.length);
  let nextOffset = offset + advancedBy;
  if (nextOffset >= total) nextOffset = 0;

  await prisma.cTRefreshCursor.update({
    where: { id: 1 },
    data: { offset: nextOffset, pageSize },
  });

  const tookMs = Date.now() - t0;
  return NextResponse.json({
    status: "ok", mode: "cursor",
    window: { offset, pageSize, nextOffset, totalBlueprints: total },
    processedIds: started, ok, fail,
    durationMs: tookMs, timeLeftMs: Math.max(0, WORK_BUDGET_MS - tookMs)
  }, { status: 200 });
}
