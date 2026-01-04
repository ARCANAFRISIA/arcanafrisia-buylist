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

function conditionToCtBucket(cond: string | null | undefined): string {
  const c = (cond || "NM").toUpperCase();
  if (c === "NEAR MINT" || c === "NM") return "NM";
  if (c === "SLIGHTLY PLAYED" || c === "EX") return "EX";
  if (c === "MODERATELY PLAYED" || c === "GD") return "GD";
  if (c === "PLAYED" || c === "LP" || c === "PL") return "PL"; // als CT PL/LP gebruikt
  return "NM"; // veilige default
}


export async function GET(req: NextRequest) {
  const url = new URL(req.url);
const channel = (url.searchParams.get("channel") || "CM").toUpperCase();
const mode = (url.searchParams.get("mode") || "relist").toLowerCase(); // "relist" | "newstock"
const markupPct = Number(url.searchParams.get("markupPct") || "0.05"); // 5% default

// ---- noCursor + since/cursor handling ----
const noCursor = url.searchParams.get("noCursor") === "1";
const sinceParam = url.searchParams.get("since");
const cursorKey =
  mode === "relist"
    ? "postsales.lastExportAt"
    : "newstock.lastExportAt";
const cursor = await prisma.syncCursor.findUnique({ where: { key: cursorKey } });

const effectiveSince =
  sinceParam ? new Date(sinceParam)
  : cursor?.value ? new Date(cursor.value)
  : new Date(Date.now() - 24 * 60 * 60 * 1000); // fallback 24h


async function lastSoldUnitPrice(
  cmid: number,
  isFoil: boolean,
  condition: string,
  language: string,
  sinceDate: Date
) {
  // zelfde buckets als in de aggregate-query
  const normCond = (condition || "NM").toUpperCase();
  const normLang = (language || "EN").toUpperCase();

  type Row = {
    unitPriceEur: number | null;
    lineTotalEur: number | null;
    qty: number | null;
  };

  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT "unitPriceEur","lineTotalEur","qty"
    FROM "SalesLog"
    WHERE "cardmarketId" = $1
      AND COALESCE("isFoil", false) = $2
      AND
        CASE
          WHEN "condition" IS NULL                     THEN 'NM'
          WHEN "condition" ILIKE 'Near Mint'           THEN 'NM'
          WHEN "condition" ILIKE 'Slightly Played'     THEN 'EX'
          WHEN "condition" ILIKE 'Moderately Played'   THEN 'GD'
          WHEN "condition" ILIKE 'Played'              THEN 'LP'
          WHEN "condition" ILIKE 'Heavily Played'      THEN 'PL'
          WHEN "condition" ILIKE 'NM'                  THEN 'NM'
          WHEN "condition" ILIKE 'EX'                  THEN 'EX'
          WHEN "condition" ILIKE 'GD'                  THEN 'GD'
          WHEN "condition" ILIKE 'LP'                  THEN 'LP'
          WHEN "condition" ILIKE 'PL'                  THEN 'PL'
          ELSE UPPER("condition")
        END = $3
      AND
        CASE
          WHEN "language" IS NULL OR "language" = ''  THEN 'EN'
          ELSE UPPER("language")
        END = $4
      AND "inventoryAppliedAt" IS NOT NULL
      AND ts >= $5
    ORDER BY ts DESC
    LIMIT 1
  `, cmid, isFoil, normCond, normLang, sinceDate as any);

  const row = rows[0];
  if (!row) return null;

  if (row.unitPriceEur != null) {
    return Number(row.unitPriceEur);
  }
  if (row.lineTotalEur != null && row.qty) {
    return Number(row.lineTotalEur) / Math.abs(Number(row.qty));
  }
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
      language: true,
      qtyOnHand: true,
    },
  });

  // Verkoop-aggregatie sinds 'since'
const soldMap = new Map<string, number>();
{
  type SoldAggRow = {
    cardmarketId: number;
    isFoil: boolean;
    condition: string;
    language: string;
    sum: number;
  };

  // Altijd condities + language normaliseren
  const rows = await prisma.$queryRawUnsafe<SoldAggRow[]>(`
    SELECT
      "cardmarketId",
      COALESCE("isFoil", false) AS "isFoil",
      CASE
        WHEN "condition" IS NULL                     THEN 'NM'
        WHEN "condition" ILIKE 'Near Mint'           THEN 'NM'
        WHEN "condition" ILIKE 'Slightly Played'     THEN 'EX'
        WHEN "condition" ILIKE 'Moderately Played'   THEN 'GD'
        WHEN "condition" ILIKE 'Played'              THEN 'LP'
        WHEN "condition" ILIKE 'Heavily Played'      THEN 'PL'
        WHEN "condition" ILIKE 'NM'                  THEN 'NM'
        WHEN "condition" ILIKE 'EX'                  THEN 'EX'
        WHEN "condition" ILIKE 'GD'                  THEN 'GD'
        WHEN "condition" ILIKE 'LP'                  THEN 'LP'
        WHEN "condition" ILIKE 'PL'                  THEN 'PL'
        ELSE UPPER("condition")
      END AS "condition",
      CASE
        WHEN "language" IS NULL OR "language" = ''  THEN 'EN'
        ELSE UPPER("language")
      END AS "language",
      COALESCE(SUM(qty),0) AS sum
    FROM "SalesLog"
    WHERE "inventoryAppliedAt" IS NOT NULL
      AND ts >= $1
    GROUP BY 1,2,3,4
  `, effectiveSince as any);

  for (const r of rows) {
    const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
    soldMap.set(key, Math.abs(Number(r.sum || 0)));
  }
}


  // Nieuwe voorraad (lots) sinds 'since' – voor mode=newstock
const newStockMap = new Map<string, number>();
{
  type NewStockAggRow = {
    cardmarketId: number;
    isFoil: boolean;
    condition: string;
    language: string;
    sum: number;
  };

  const rows = await prisma.$queryRawUnsafe<NewStockAggRow[]>(`
    SELECT
      "cardmarketId",
      COALESCE("isFoil", false) AS "isFoil",
      CASE
        WHEN "condition" IS NULL                     THEN 'NM'
        WHEN "condition" ILIKE 'Near Mint'           THEN 'NM'
        WHEN "condition" ILIKE 'Slightly Played'     THEN 'EX'
        WHEN "condition" ILIKE 'Moderately Played'   THEN 'GD'
        WHEN "condition" ILIKE 'Played'              THEN 'LP'
        WHEN "condition" ILIKE 'Heavily Played'      THEN 'PL'
        WHEN "condition" ILIKE 'NM'                  THEN 'NM'
        WHEN "condition" ILIKE 'EX'                  THEN 'EX'
        WHEN "condition" ILIKE 'GD'                  THEN 'GD'
        WHEN "condition" ILIKE 'LP'                  THEN 'LP'
        WHEN "condition" ILIKE 'PL'                  THEN 'PL'
        ELSE UPPER("condition")
      END AS "condition",
      CASE
        WHEN "language" IS NULL OR "language" = ''  THEN 'EN'
        ELSE UPPER("language")
      END AS "language",
      COALESCE(SUM("qtyRemaining"),0) AS sum
    FROM "InventoryLot"
    WHERE "sourceDate" >= $1
      AND "qtyRemaining" > 0
    GROUP BY 1,2,3,4
  `, effectiveSince as any);

  for (const r of rows) {
    const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
    newStockMap.set(key, Math.abs(Number(r.sum || 0)));
  }
}





  // Price refs (CM trend)
 const cmIds = Array.from(
  new Set(
    balances
      .map((b) => Number(b.cardmarketId))
      .filter((n) => Number.isFinite(n))
  )
) as number[];

if (!cmIds.length) {
  // Geen data → lege CSV teruggeven
  return new Response("cardmarketId,isFoil,condition,language,addQty,priceEur,policyName,sourceCode\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="post-sales-${channel}-${Date.now()}.csv"`,
    },
  });
}

const cmTrendMap = new Map<number, number>();
if (cmIds.length) {
  const rows = await prisma.$queryRawUnsafe<
    { cardmarketId: number; trend: any | null }[]
  >(
    `
      SELECT "cardmarketId", "trend"
      FROM "CMPriceGuide"
      WHERE "cardmarketId" = ANY($1)
    `,
    cmIds
  );

  for (const r of rows) {
    if (r.trend != null) {
      cmTrendMap.set(Number(r.cardmarketId), Number(r.trend));
    }
  }
}


  // CT min via mapping -> CTMarketSummary
const mapRows = await prisma.$queryRawUnsafe<
  { cardmarketId: number; blueprintId: number | null }[]
>(
  `
    SELECT "cardmarketId","blueprintId"
    FROM "BlueprintMapping"
    WHERE "cardmarketId" = ANY($1)
  `,
  cmIds
);

const bpByCmid = new Map<number, number>();
const bpIds = new Set<number>();

for (const r of mapRows) {
  if (r.blueprintId != null) {
    const cmid = Number(r.cardmarketId);
    const bp = Number(r.blueprintId);
    bpByCmid.set(cmid, bp);
    bpIds.add(bp);
  }
}


const ctMinMap = new Map<number, number>(); // key: cardmarketId
if (bpIds.size) {
  const bpArr = Array.from(bpIds) as number[];

  const rows = await prisma.cTMarketSummary.findMany({
    where: { blueprintId: { in: bpArr } },
    select: { blueprintId: true, minPrice: true },
  });

  const ctByBp = new Map<number, number>();
  for (const r of rows) {
    if (r.minPrice != null) {
      ctByBp.set(Number(r.blueprintId), Number(r.minPrice));
    }
  }

  for (const [cmid, bp] of bpByCmid.entries()) {
    const v = ctByBp.get(bp);
    if (v != null) {
      ctMinMap.set(cmid, v);
    }
  }
}


    // CT min per conditie + foil uit CTMarketLatest
  type CtLatestRow = {
    cardmarketId: number;
    isFoil: boolean;
    bucket: string;
    minPrice: number | null;
  };

  const ctMinByCond = new Map<string, number>(); // key: cmid|foil|bucket

  if (cmIds.length) {
    const ctRows = await prisma.$queryRawUnsafe<CtLatestRow[]>(`
      SELECT "cardmarketId","isFoil","bucket","minPrice"
      FROM "CTMarketLatest"
      WHERE "cardmarketId" = ANY($1)
    `, cmIds);

    for (const r of ctRows) {
      if (r.minPrice == null) continue;
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${(r.bucket || "").toUpperCase()}`;
      const val = Number(r.minPrice);
      // als er meerdere snapshots zijn, pak de laagste minPrice
      const existing = ctMinByCond.get(key);
      if (existing == null || val < existing) {
        ctMinByCond.set(key, val);
      }
    }
  }


  // Helper: haal FIFO bron (sourceCode) van eerste lot met voorraad
  async function firstLotSourceCode(
  cmid: number,
  isFoil: boolean,
  condition: string,
  language: string
) {
  const lot = await prisma.inventoryLot.findFirst({
    where: {
      cardmarketId: cmid,
      isFoil,
      condition,
      language,                    
      qtyRemaining: { gt: 0 },
    },
    select: { sourceCode: true, sourceDate: true, createdAt: true },
    orderBy: [{ sourceDate: "asc" }, { createdAt: "asc" }],
  });
  return lot?.sourceCode ?? null;
}


  // Bouw CSV
  const header = "cardmarketId,isFoil,condition,language,addQty,priceEur,policyName,sourceCode\n";

  const lines: string[] = [header];

  let considered = 0, emitted = 0, skippedNoPrice = 0;

    for (const b of balances) {
    considered++;
    const key = `${b.cardmarketId}|${b.isFoil ? 1 : 0}|${b.condition}|${b.language}`;


    const soldSinceUpdate = soldMap.get(key) || 0;
    const newStockSince   = newStockMap.get(key) || 0;

    if (b.qtyOnHand <= 0) continue;

    let addQty = 0;

    if (mode === "relist") {
      // 🔁 Relist: gebaseerd op verkochte aantallen sinds 'since'
      if (soldSinceUpdate <= 0) continue;

      const tierNow = policy.tiers.find(t => b.qtyOnHand >= t.minOnHand) || null;
      const capNow  = tierNow?.listQty ?? 0;

      addQty = Math.max(
        0,
        Math.min(soldSinceUpdate, capNow, b.qtyOnHand)
      );
    } else {
      // 🆕 Newstock: alleen het extra boven wat je *voor* de restock zou willen
      if (newStockSince <= 0) continue;

      // Huidige tier / cap op basis van huidige voorraad
      const tierNow = policy.tiers.find(t => b.qtyOnHand >= t.minOnHand) || null;
      const capNow  = tierNow?.listQty ?? 0;

      // Schatting oude voorraad vóór deze new stock
      const oldOnHand = Math.max(0, b.qtyOnHand - newStockSince);

      // Tier / cap op basis van oude voorraad
      const tierOld = policy.tiers.find(t => oldOnHand >= t.minOnHand) || null;
      const capOld  = tierOld?.listQty ?? 0;

      const desiredNow = Math.min(capNow, b.qtyOnHand);
      const desiredOld = Math.min(capOld, oldOnHand);

      const extraNeeded = Math.max(0, desiredNow - desiredOld);

      // Nooit meer exporteren dan er nieuwe stock bijgekomen is of wat je op voorraad hebt
      addQty = Math.max(
        0,
        Math.min(extraNeeded, newStockSince, b.qtyOnHand)
      );
    }

        if (addQty <= 0) continue;

    let price: number | null = null;

    if (mode === "relist") {
      const last = await lastSoldUnitPrice(
        b.cardmarketId,
        b.isFoil,
        b.condition,
        b.language,
        effectiveSince
      );

      if (last != null && last > 0) {
        // markupPct uit de query (0.05 = 5%, 0 = geen opslag)
        price = last * (1 + (isFinite(markupPct) ? markupPct : 0.05));
      } else {
        // fallback: marktprijzen – eerst CT per conditie, dan CT summary, dan CM trend
        const cmTrend = cmTrendMap.get(b.cardmarketId) ?? null;

        const bucket = conditionToCtBucket(b.condition);
        const ctKey  = `${b.cardmarketId}|${b.isFoil ? 1 : 0}|${bucket}`;
        const ctMinByBucket = ctMinByCond.get(ctKey) ?? null;

        const ctMinGlobal = ctMinMap.get(b.cardmarketId) ?? null;
        const ctMin = ctMinByBucket ?? ctMinGlobal;

        if (cmTrend != null || ctMin != null) {
          const base = ctMin ?? (cmTrend ?? 0) * 1.10;

          price = base;
        }
      }
    } else {
      // mode === "newstock"
      const cmTrend = cmTrendMap.get(b.cardmarketId) ?? null;

      const bucket = conditionToCtBucket(b.condition);
      const ctKey  = `${b.cardmarketId}|${b.isFoil ? 1 : 0}|${bucket}`;
      const ctMinByBucket = ctMinByCond.get(ctKey) ?? null;

      const ctMinGlobal = ctMinMap.get(b.cardmarketId) ?? null;
      const ctMin = ctMinByBucket ?? ctMinGlobal;

      if (cmTrend != null || ctMin != null) {
        const base = Math.max(ctMin ?? 0, (cmTrend ?? 0) * 1.10);
        price = base;
      } else {
        // Fallback voor kaarten zonder marktprijs
        price = 1000; // Signaalwaarde zodat je ze handmatig checkt
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

    const src = await firstLotSourceCode(b.cardmarketId, b.isFoil, b.condition, b.language);
    const row = [
      csvEscape(b.cardmarketId),
      csvEscape(b.isFoil),
      csvEscape(b.condition),
      csvEscape(b.language),
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
