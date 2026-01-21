import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PriceSource = "CT_MIN" | "CM_TREND" | "NONE";

function csvEscape(s: any) {
  const v = (s ?? "").toString();
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

type PlanRow = {
  lotId: string;
  location: string | null;
  qty: number;

  cardmarketId: number;
  blueprintId: number | null;

  set: string;
  name: string;
  collectorNumber: string | null;

  condition: string;
  language: string;
  isFoil: boolean;

  sourceCode: string;
  sourceDate: string;

  priceEur: number | null;
  priceSource: PriceSource;
};

export async function GET(req: NextRequest) {
  try {
    // auth
    if (process.env.NODE_ENV === "production") {
      const token = req.headers.get("x-admin-token");
      if (!token || token !== process.env.ADMIN_TOKEN) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
    }

    const url = new URL(req.url);
    const min = Number(url.searchParams.get("minPrice") ?? "1");
    const minPrice = Number.isFinite(min) ? min : 1;

    const format = (url.searchParams.get("format") ?? "json").toLowerCase(); // json|csv

    // 1) lots
    const lots = await prisma.inventoryLot.findMany({
      where: {
        qtyRemaining: { gt: 0 },
        location: { not: null },
      },
      select: {
        id: true,
        cardmarketId: true,
        isFoil: true,
        condition: true,
        language: true,
        qtyRemaining: true,
        location: true,
        sourceCode: true,
        sourceDate: true,
      },
    });

    if (!lots.length) {
      return NextResponse.json({ ok: true, minPrice, count: 0, plan: [] as PlanRow[] });
    }

    const cmids = Array.from(new Set(lots.map(l => l.cardmarketId)));

    // 2) scryfall lookup
    const lookups = await prisma.scryfallLookup.findMany({
      where: { cardmarketId: { in: cmids } },
      select: {
        cardmarketId: true,
        scryfallId: true,
        set: true,
        name: true,
        collectorNumber: true,
      },
    });

    const luByCmid = new Map<number, { scryfallId: string; set: string; name: string; collectorNumber: string | null }>();
    for (const l of lookups) {
      luByCmid.set(l.cardmarketId, {
        scryfallId: l.scryfallId,
        set: l.set,
        name: l.name,
        collectorNumber: l.collectorNumber ?? null,
      });
    }

    const scryIds = Array.from(new Set(lookups.map(l => l.scryfallId)));

    // 3) policies (alleen CTBULK)
    const policies = await prisma.stockPolicy.findMany({
      where: {
        scryfallId: { in: scryIds },
        stockClass: "CTBULK",
      },
      select: { scryfallId: true },
    });
    const isBulkBySid = new Set(policies.map(p => p.scryfallId));

    // 4) prijzen: CTMarketLatest minPrice (laagste over buckets) per (cardmarketId,isFoil)
    const ctRows = await prisma.cTMarketLatest.findMany({
      where: {
        cardmarketId: { in: cmids },
      },
      select: {
        blueprintId: true,
        bucket: true,
        isFoil: true,
        minPrice: true,
        cardmarketId: true,
      },
    });

    // pick minimum minPrice + remember blueprintId (of that min)
    const ctMinByKey = new Map<string, { minPrice: number; blueprintId: number }>();
    for (const r of ctRows) {
      if (r.cardmarketId == null) continue;
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}`;
      const p = r.minPrice;
      if (p == null || !Number.isFinite(p)) continue;

      const cur = ctMinByKey.get(key);
      if (!cur || p < cur.minPrice) {
        ctMinByKey.set(key, { minPrice: p, blueprintId: r.blueprintId });
      }
    }

    // 5) fallback: CMPriceGuide
    const cmGuides = await prisma.cMPriceGuide.findMany({
      where: { cardmarketId: { in: cmids } },
      select: { cardmarketId: true, trend: true, foilTrend: true },
    });
    const cmById = new Map<number, { trend: number | null; foilTrend: number | null }>();
    for (const g of cmGuides) {
      cmById.set(g.cardmarketId, {
        trend: g.trend ?? null,
        foilTrend: g.foilTrend ?? null,
      });
    }

    // 6) build plan rows (per lot)
    const plan: PlanRow[] = [];
    let skippedNoPolicy = 0;
    let skippedLowPrice = 0;

    for (const lot of lots) {
      const lu = luByCmid.get(lot.cardmarketId);
      if (!lu) { skippedNoPolicy++; continue; }
      if (!isBulkBySid.has(lu.scryfallId)) { skippedNoPolicy++; continue; } // alleen CTBULK

      const key = `${lot.cardmarketId}|${lot.isFoil ? 1 : 0}`;

      const ctMin = ctMinByKey.get(key);
      const cm = cmById.get(lot.cardmarketId);

      let priceEur: number | null = null;
      let priceSource: PriceSource = "NONE";
      let blueprintId: number | null = null;

      if (ctMin) {
        priceEur = ctMin.minPrice;
        blueprintId = ctMin.blueprintId;
        priceSource = "CT_MIN";
      } else if (cm) {
        const p = lot.isFoil ? cm.foilTrend : cm.trend;
        if (p != null && Number.isFinite(p)) {
          priceEur = p;
          priceSource = "CM_TREND";
        }
      }

      if (priceEur == null || priceEur < minPrice) {
        skippedLowPrice++;
        continue;
      }

      plan.push({
        lotId: lot.id,
        location: lot.location ?? null,
        qty: Number(lot.qtyRemaining ?? 0),

        cardmarketId: lot.cardmarketId,
        blueprintId,

        set: lu.set ?? "",
        name: lu.name ?? "",
        collectorNumber: lu.collectorNumber ?? null,

        condition: lot.condition,
        language: lot.language,
        isFoil: lot.isFoil,

        sourceCode: lot.sourceCode,
        sourceDate: lot.sourceDate.toISOString(),

        priceEur,
        priceSource,
      });
    }

    // sort: locatie eerst (pick efficiënt)
    plan.sort((a, b) => {
      const la = (a.location ?? "").localeCompare(b.location ?? "");
      if (la !== 0) return la;
      const s = (a.set ?? "").localeCompare(b.set ?? "");
      if (s !== 0) return s;
      const n = (a.name ?? "").localeCompare(b.name ?? "");
      if (n !== 0) return n;
      const c = (a.condition ?? "").localeCompare(b.condition ?? "");
      if (c !== 0) return c;
      const l = (a.language ?? "").localeCompare(b.language ?? "");
      if (l !== 0) return l;
      return Number(a.isFoil) - Number(b.isFoil);
    });

    if (format === "csv") {
      const header = [
        "location","qty","cardmarketId","blueprintId","set","name","collectorNumber",
        "condition","language","isFoil","priceEur","priceSource","sourceCode","sourceDate","lotId"
      ];
      const lines = [header.join(",")];
      for (const r of plan) {
        lines.push([
          csvEscape(r.location ?? ""),
          csvEscape(r.qty),
          csvEscape(r.cardmarketId),
          csvEscape(r.blueprintId ?? ""),
          csvEscape(r.set),
          csvEscape(r.name),
          csvEscape(r.collectorNumber ?? ""),
          csvEscape(r.condition),
          csvEscape(r.language),
          csvEscape(r.isFoil ? "1" : "0"),
          csvEscape(r.priceEur ?? ""),
          csvEscape(r.priceSource),
          csvEscape(r.sourceCode),
          csvEscape(r.sourceDate),
          csvEscape(r.lotId),
        ].join(","));
      }

      return new NextResponse(lines.join("\n"), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return NextResponse.json({
      ok: true,
      minPrice,
      count: plan.length,
      skippedNoPolicy,
      skippedLowPrice,
      plan,
    });
  } catch (e: any) {
    console.error("ct1day plan error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
