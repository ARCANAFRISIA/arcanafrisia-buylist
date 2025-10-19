import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Pro: max 60s

function envBaseUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL;
  const fromVercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
  return fromEnv || fromVercel || "http://localhost:3000";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, next: { revalidate: 0 } });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const BASE = envBaseUrl();

  // Defaults (tune via env)
  const CONC = Number(process.env.CT_CRON_CONCURRENCY ?? 4); // conservatief
  const DELAY = Number(process.env.CT_CRON_DELAY_MS ?? 100); // kleine adempauze tussen hits
  const WORK_BUDGET_MS = 45_000; // werkbudget binnen function runtime

  const sp = req.nextUrl.searchParams;
  const debug = sp.get("debug") === "1";

  // Filters (houd snel en simpel; summary-route schrijft beide buckets weg)
  const cond = (sp.get("cond") || "NM,EX,GD").toUpperCase(); // altijd NM/EX/GD als default
  const zero = (sp.get("zero") || "pro").toLowerCase(); // 'pro' default
  const lang = (sp.get("lang") || "en").toLowerCase(); // 'en' of leeg → wij kiezen 'en'
  // Belangrijk: GEEN foil-param hier → 1 call per blueprint en summary schrijft NF+Foil

  // Helper: verwerk een lijst blueprintIds binnen tijdsbudget
  async function processIds(ids: number[]) {
    let ok = 0,
      fail = 0,
      started = 0;

    const qs = new URLSearchParams({
      cond,
      lang,
      zero,
      // foil NIET zetten → summary-route maakt beide buckets
      self: "include",
    });

    const timeLeft = () => Math.max(0, WORK_BUDGET_MS - (Date.now() - t0));

    for (let i = 0; i < ids.length; i += CONC) {
      if (timeLeft() < 1500) break; // hou speling over
      const wave = ids.slice(i, i + CONC);

      // Start deze wave
      const tasks = wave.map(async (bp) => {
        const url = `${BASE}/api/providers/ct/summary?blueprintId=${bp}&${qs.toString()}`;
        try {
          started++;
          await fetchWithTimeout(url, 8000);
          ok++;
        } catch (e) {
          console.error("ct-refresh error", bp, (e as Error)?.message || e);
          fail++;
        } finally {
          // kleine delay zodat we CT & function niet verstikken
          if (DELAY > 0) await sleep(DELAY);
        }
      });

      await Promise.all(tasks);

      // Check na iedere wave of we door mogen
      if (timeLeft() < 1500) break;
    }

    return { started, ok, fail };
  }

  try {
    // MODE A: handmatige window (testing)
    if (sp.get("limit")) {
      const limit = Math.max(1, Number(sp.get("limit")));
      const offset = Math.max(0, Number(sp.get("offset") || 0));

      const ids = await prisma.blueprintMapping
        .findMany({
          select: { blueprintId: true },
          orderBy: { blueprintId: "asc" },
          skip: offset,
          take: limit,
        })
        .then((r) => r.map((x) => x.blueprintId));

      if (!ids.length) {
        return NextResponse.json({ status: "empty", message: "No ids in this window" }, { status: 200 });
      }

      const stats = await processIds(ids);
      const tookMs = Date.now() - t0;

      return NextResponse.json(
        {
          status: "ok",
          mode: "window",
          window: { offset, limit },
          ...stats,
          durationMs: tookMs,
          timeLeftMs: Math.max(0, WORK_BUDGET_MS - tookMs),
          base: BASE,
          debug,
        },
        { status: 200 }
      );
    }

    // MODE B: cursor (default pad via cron)
    const total = await prisma.blueprintMapping.count();

    // Zorg voor cursor row
    let cursor = await prisma.cTRefreshCursor.findUnique({ where: { id: 1 } });
    if (!cursor) {
      cursor = await prisma.cTRefreshCursor.create({
        data: { id: 1, offset: 0, pageSize: 150 },
      });
    }

    const offset = Math.max(0, cursor.offset ?? 0);
    const pageSize = Math.max(50, Math.min(Number(sp.get("pageSize") ?? cursor.pageSize ?? 150), 300));

    const ids = await prisma.blueprintMapping
      .findMany({
        select: { blueprintId: true },
        orderBy: { blueprintId: "asc" },
        skip: offset,
        take: pageSize,
      })
      .then((r) => r.map((x) => x.blueprintId));

    if (!ids.length) {
      // wrap naar 0
      await prisma.cTRefreshCursor.update({ where: { id: 1 }, data: { offset: 0 } });
      return NextResponse.json(
        {
          status: "ok",
          mode: "cursor",
          note: "Reached end; wrapped to 0. Nothing processed.",
          totalBlueprints: total,
          processedIds: 0,
          ok: 0,
          fail: 0,
          durationMs: Date.now() - t0,
        },
        { status: 200 }
      );
    }

    // Verwerk ids tijd-geboxed
    const stats = await processIds(ids);

    // Cursor opschuiven met daadwerkelijk "aangeraakte" ids
    const advancedBy = Math.min(stats.started, ids.length);
    let nextOffset = offset + advancedBy;
    if (nextOffset >= total) nextOffset = 0;

    await prisma.cTRefreshCursor.update({
      where: { id: 1 },
      data: { offset: nextOffset, pageSize },
    });

    const tookMs = Date.now() - t0;

    return NextResponse.json(
      {
        status: "ok",
        mode: "cursor",
        window: { offset, pageSize, nextOffset, totalBlueprints: total },
        processedIds: stats.started,
        ok: stats.ok,
        fail: stats.fail,
        durationMs: tookMs,
        timeLeftMs: Math.max(0, WORK_BUDGET_MS - tookMs),
        base: BASE,
        debug,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ status: "error", error: String(e?.message || e) }, { status: 500 });
  }
}
