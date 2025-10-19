import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

function envBaseUrl() {
  // Works locally and on Vercel
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL;
  const fromVercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
  return fromEnv || fromVercel || "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();

  try {
    const sp = req.nextUrl.searchParams;

    // filters
    const cond = (sp.get("cond") || "NM,EX,GD").toUpperCase();

    // runner config (tune via env)
    const BASE  = envBaseUrl();
    const CONC  = Number(process.env.CT_CRON_CONCURRENCY ?? 5);
    const DELAY = Number(process.env.CT_CRON_DELAY_MS ?? 150);
    const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));

    async function processIds(ids: number[]) {
      const paramsNF = new URLSearchParams({ cond, lang:"en", foil:"0", zero:"pro", self:"include" });
      const paramsF  = new URLSearchParams({ cond, lang:"en", foil:"1", zero:"pro", self:"include" });

      let ok=0, fail=0;

      async function hit(bp:number, p:URLSearchParams){
        const url = `${BASE}/api/providers/ct/summary?blueprintId=${bp}&${p.toString()}`;
        try {
          const r = await fetch(url, { next: { revalidate: 0 }});
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
          ok++;
        } catch (e) {
          console.error("ct-refresh error", bp, e);
          fail++;
        } finally {
          await sleep(DELAY);
        }
      }

      for (let i=0; i<ids.length; i+=CONC) {
        const wave = ids.slice(i, i+CONC);
        await Promise.all(wave.flatMap(bp => [ hit(bp, paramsNF), hit(bp, paramsF) ]));
      }

      return { processed: ids.length * 2, ok, fail };
    }

    // MODE A: manual window if limit provided (for testing)
    const limitParam = sp.get("limit");
    if (limitParam) {
      const limit  = Number(limitParam);
      const offset = Number(sp.get("offset") || 0);

      const ids = await prisma.blueprintMapping.findMany({
        select: { blueprintId: true },
        orderBy: { blueprintId: "asc" },
        skip: offset,
        take: limit,
      }).then(r => r.map(x => x.blueprintId));

      if (!ids.length) {
        return NextResponse.json({ ok:false, message:"No blueprints in mapping for this window" }, { status:400 });
      }

      const stats = await processIds(ids);
      return NextResponse.json({
        ok: 200, mode: "window", window: { limit, offset },
        ...stats, durationMs: Date.now() - t0
      });
    }

    // MODE B: cursor (no limit param) — one page per invocation
    const total = await prisma.blueprintMapping.count();

    // ensure there is a cursor row
    let cursor = await prisma.cTRefreshCursor.findUnique({ where: { id: 1 }});
    if (!cursor) {
      cursor = await prisma.cTRefreshCursor.create({ data: { id: 1, offset: 0, pageSize: 250 }});
    }

    const offset = cursor.offset ?? 0;
    const pageSize = Number(sp.get("pageSize") ?? cursor.pageSize ?? 250);

    const ids = await prisma.blueprintMapping.findMany({
      select: { blueprintId: true },
      orderBy: { blueprintId: "asc" },
      skip: offset,
      take: pageSize,
    }).then(r => r.map(x => x.blueprintId));

    if (!ids.length) {
      // wrap around to start when reaching the end
      await prisma.cTRefreshCursor.update({ where: { id: 1 }, data: { offset: 0 }});
      return NextResponse.json({
        ok: 200, mode: "cursor",
        note: "Reached end of mapping — wrapped to 0. Nothing processed in this run.",
        totalBlueprints: total, processed: 0, ok: 0, fail: 0,
        durationMs: Date.now() - t0
      });
    }

    const stats = await processIds(ids);

    // advance cursor, wrap at total
    let nextOffset = offset + pageSize;
    if (nextOffset >= total) nextOffset = 0;
    await prisma.cTRefreshCursor.update({ where: { id: 1 }, data: { offset: nextOffset, pageSize }});

    return NextResponse.json({
      ok: 200, mode: "cursor",
      window: { offset, pageSize, nextOffset, totalBlueprints: total },
      ...stats, durationMs: Date.now() - t0
    });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}
