import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function roundStep(v: number, step = 0.05) {
  if (!step || step <= 0) return Math.round(v * 100) / 100;
  return Math.round(v / step) * step;
}

function csvEscape(s: string | number | boolean | null | undefined) {
  const v = s == null ? "" : String(s);
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
const channel = (url.searchParams.get("channel") || "CM").toUpperCase();
const mode = (url.searchParams.get("mode") || "relist").toLowerCase(); // "relist" | "newstock"
const markupPct = Number(url.searchParams.get("markupPct") || "0.05"); // 5% default

// ---- noCursor + since/cursor handling ----
const noCursor = url.searchParams.get("noCursor") === "1";
const sinceParam = url.searchParams.get("since");
const cursorKey = `post_sales_export.${channel.toLowerCase()}.${mode}`; // per channel+mode
const cursor = await prisma.syncCursor.findUnique({ where: { key: cursorKey } });

const effectiveSince =
  sinceParam ? new Date(sinceParam)
  : cursor?.value ? new Date(cursor.value)
  : new Date(Date.now() - 24 * 60 * 60 * 1000); // fallback 24h


  async function lastSoldUnitPrice(cmid: number, isFoil: boolean, condition: string, sinceDate: Date) {
  const row = await prisma.salesLog.findFirst({
    where: {
      cardmarketId: cmid,
      isFoil,
      condition,
      inventoryAppliedAt: { not: null },
      ts: { gte: effectiveSince },
    },
    select: { unitPriceEur: true, lineTotalEur: true, qty: true, ts: true },
    orderBy: { ts: "desc" },
  });
  if (!row) return null;
  if (row.unitPriceEur != null) return Number(row.unitPriceEur);
  if (row.lineTotalEur != null && row.qty) return Number(row.lineTotalEur) / Math.abs(Number(row.qty));
  return null;
}


  // Policy ophalen
  const policy = await prisma.listPolicy.findFirst({
    where: { channel, enabled: true },
    include: { tiers: { orderBy: { minOnHand: "desc" } } },
  });
  if (!policy) {
    return new Response("No enabled ListPolicy for channel", { status: 400 });
  }

  // Kandidaten: alle SKU's met voorraad of met sales sinds 'since'
  // (balance universe is voldoende, sales filter gebruiken we later)
  const balances = await prisma.inventoryBalance.findMany({
    select: {
      cardmarketId: true,
      isFoil: true,
      condition: true,
      qtyOnHand: true,
    },
  });

  // Verkoop-aggregatie sinds 'since'
  const soldMap = new Map<string, number>();
  {
    const rows: Array<{ cardmarketId: number; isFoil: boolean; condition: string; sum: number }> =
      await prisma.$queryRawUnsafe(`
        SELECT "cardmarketId", "isFoil", "condition", COALESCE(SUM(qty),0) AS sum
        FROM "SalesLog"
        WHERE "inventoryAppliedAt" IS NOT NULL
          AND ts >= $1
        GROUP BY 1,2,3
      `, since);
    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}`;
      soldMap.set(key, Math.abs(Number(r.sum || 0)));
    }
  }

  // Price refs (CM trend)
  const cmIds = Array.from(new Set(balances.map(b => b.cardmarketId)));
  const cmTrendMap = new Map<number, number>();
  if (cmIds.length) {
    const rows: Array<{ cardmarketId: number; trend: number | null }> =
      await prisma.$queryRawUnsafe(`
        SELECT "cardmarketId", "trend"
        FROM "CMPriceGuide"
        WHERE "cardmarketId" = ANY($1)
      `, cmIds);
    rows.forEach(r => {
      if (r.trend != null) cmTrendMap.set(r.cardmarketId, Number(r.trend));
    });
  }

  // CT min via mapping -> CTMarketSummary
  const mapRows: Array<{ cardmarketId: number; blueprintId: number | null }> =
    await prisma.$queryRawUnsafe(`
      SELECT "cardmarketId","blueprintId"
      FROM "BlueprintMapping"
      WHERE "cardmarketId" = ANY($1)
    `, cmIds);

  const bpByCmid = new Map<number, number>();
  const bpIds = new Set<number>();
  mapRows.forEach(r => { if (r.blueprintId != null) { bpByCmid.set(r.cardmarketId, r.blueprintId); bpIds.add(r.blueprintId); } });

  const ctMinMap = new Map<number, number>(); // key: cardmarketId
  if (bpIds.size) {
    const rows: Array<{ blueprintId: number; minPrice: number | null }> =
      await prisma.$queryRawUnsafe(`
        SELECT "blueprintId","minPrice"
        FROM "CTMarketSummary"
        WHERE "blueprintId" = ANY($1)
      `, Array.from(bpIds));
    const ctByBp = new Map<number, number>();
    rows.forEach(r => { if (r.minPrice != null) ctByBp.set(r.blueprintId, Number(r.minPrice)); });
    for (const [cmid, bp] of bpByCmid.entries()) {
      const v = ctByBp.get(bp);
      if (v != null) ctMinMap.set(cmid, v);
    }
  }

  // Helper: haal FIFO bron (sourceCode) van eerste lot met voorraad
  async function firstLotSourceCode(cmid: number, isFoil: boolean, condition: string) {
    const lot = await prisma.inventoryLot.findFirst({
      where: { cardmarketId: cmid, isFoil, condition, qtyRemaining: { gt: 0 } },
      select: { sourceCode: true, sourceDate: true, createdAt: true },
      orderBy: [{ sourceDate: "asc" }, { createdAt: "asc" }],
    });
    return lot?.sourceCode ?? null;
  }

  // Bouw CSV
  const header = "cardmarketId,isFoil,condition,addQty,priceEur,policyName,sourceCode\n";
  const lines: string[] = [header];

  let considered = 0, emitted = 0, skippedNoPrice = 0;

  for (const b of balances) {
    considered++;
    const key = `${b.cardmarketId}|${b.isFoil ? 1 : 0}|${b.condition}`;
    const soldSinceUpdate = soldMap.get(key) || 0;
    if (soldSinceUpdate <= 0 && b.qtyOnHand <= 0) continue; // niets te doen

    // tier kiezen
    const tier = policy.tiers.find(t => b.qtyOnHand >= t.minOnHand) || null;
    const policyCap = tier?.listQty ?? 0;

    // addQty = MAX(0, MIN(soldSinceUpdate, policyCap, onHand))
    const addQty = Math.max(0, Math.min(soldSinceUpdate, policyCap, b.qtyOnHand));
    if (addQty <= 0) continue;

    // prijs: max(CT_min, CM_trend * 1.10), afronden 0.05
    const cmTrend = cmTrendMap.get(b.cardmarketId) ?? null;
    const ctMin   = ctMinMap.get(b.cardmarketId) ?? null;

    let price: number | null = null;

if (mode === "relist") {
  const last = await lastSoldUnitPrice(b.cardmarketId, b.isFoil, b.condition, since);
  if (last != null && last > 0) {
    price = last * (1 + (isFinite(markupPct) ? markupPct : 0.05));
  } else {
    // fallback: newstock-regel
    const cmTrend = cmTrendMap.get(b.cardmarketId) ?? null;
    const ctMin   = ctMinMap.get(b.cardmarketId) ?? null;
    if (cmTrend != null || ctMin != null) {
      const base = Math.max(ctMin ?? 0, (cmTrend ?? 0) * 1.10);
      price = base;
    }
  }
} else { // mode === "newstock"
  const cmTrend = cmTrendMap.get(b.cardmarketId) ?? null;
  const ctMin   = ctMinMap.get(b.cardmarketId) ?? null;
  if (cmTrend != null || ctMin != null) {
    const base = Math.max(ctMin ?? 0, (cmTrend ?? 0) * 1.10);
    price = base;
  }
}

// afronden
if (price != null && price > 0) {
  const step = Number(policy.roundingStepEur ?? 0.05) || 0.05;
  price = roundStep(price, step);
}


    if (price == null || !(price > 0)) {
      skippedNoPrice++;
      continue;
    }

    const src = await firstLotSourceCode(b.cardmarketId, b.isFoil, b.condition);
    const row = [
      csvEscape(b.cardmarketId),
      csvEscape(b.isFoil),
      csvEscape(b.condition),
      csvEscape(addQty),
      csvEscape(price.toFixed(2)),
      csvEscape(policy.name),
      csvEscape(src ?? "")
    ].join(",") + "\n";
    lines.push(row);
    emitted++;
  }

  // Cursor bijwerken: postsales.lastExportAt = now()
  if (!noCursor) {
  await prisma.syncCursor.upsert({
    where: { key: cursorKey },
    update: { value: new Date().toISOString(), updatedAt: new Date() },
    create: { key: cursorKey, value: new Date().toISOString(), updatedAt: new Date() },
  });
}



  return new Response(lines.join(""), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="post-sales-${channel}-${Date.now()}.csv"`
    }
  });
}
