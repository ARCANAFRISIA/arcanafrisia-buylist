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

function normCondSql(expr: string) {
  return `
    CASE
      WHEN ${expr} IS NULL                     THEN 'NM'
      WHEN ${expr} ILIKE 'Near Mint'           THEN 'NM'
      WHEN ${expr} ILIKE 'Slightly Played'     THEN 'EX'
      WHEN ${expr} ILIKE 'Moderately Played'   THEN 'GD'
      WHEN ${expr} ILIKE 'Played'              THEN 'LP'
      WHEN ${expr} ILIKE 'Heavily Played'      THEN 'PL'
      WHEN ${expr} ILIKE 'NM'                  THEN 'NM'
      WHEN ${expr} ILIKE 'EX'                  THEN 'EX'
      WHEN ${expr} ILIKE 'GD'                  THEN 'GD'
      WHEN ${expr} ILIKE 'LP'                  THEN 'LP'
      WHEN ${expr} ILIKE 'PL'                  THEN 'PL'
      ELSE UPPER(${expr})
    END
  `;
}

function normLangSql(expr: string) {
  return `
    CASE
      WHEN ${expr} IS NULL OR ${expr} = '' THEN 'EN'
      ELSE UPPER(${expr})
    END
  `;
}

function conditionToCtBucket(cond: string | null | undefined): string {
  const c = (cond || "NM").toUpperCase();
  if (c === "NEAR MINT" || c === "NM") return "NM";
  if (c === "SLIGHTLY PLAYED" || c === "EX") return "EX";
  if (c === "MODERATELY PLAYED" || c === "GD") return "GD";
  if (c === "PLAYED" || c === "LP" || c === "PL") return "PL";
  return "NM";
}

function buildComment(channel: string, location: string | null, sourceCode: string | null) {
  const loc = (location ?? "").trim();
  const src = (sourceCode ?? "").trim();
  const ch = (channel || "CM").toUpperCase();

  if (ch === "CTBULK") {
    // geen reclame
    return `${loc} | ${src}`.trim();
  }

  return `Tracked letter NL 4,- EU 5,- | Fast and Secure shipping | ${loc} | ${src}`.trim();
}

function normalizeChannel(raw: string) {
  const ch = (raw || "CM").toUpperCase();
  if (ch === "CT") return "CTBULK"; // UI compat
  return ch;
}

function normalizeMode(raw: string) {
  const m = (raw || "relist").toLowerCase();
  if (m === "full" || m === "newstock" || m === "relist") return m;
  return "relist";
}

function cursorKeyFor(channel: string, mode: string) {
  const ch = channel.toUpperCase();
  const m = mode.toLowerCase();
  if (ch === "CTBULK") return `ctbulk.${m}.lastExportAt`;
  return `cm.${m}.lastExportAt`;
}

type Bal = {
  cardmarketId: number;
  isFoil: boolean;
  condition: string;
  language: string;
  qtyOnHand: number;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const channel = normalizeChannel(url.searchParams.get("channel") || "CM");
  const mode = normalizeMode(url.searchParams.get("mode") || "relist");
  const markupPct = Number(url.searchParams.get("markupPct") || "0.05");

  const noCursor = url.searchParams.get("noCursor") === "1";
  const sinceParam = url.searchParams.get("since");

  const cursorKey = cursorKeyFor(channel, mode);
  const cursor = await prisma.syncCursor.findUnique({ where: { key: cursorKey } });

  const effectiveSince =
    mode === "full"
      ? new Date(0)
      : sinceParam
        ? new Date(sinceParam)
        : cursor?.value
          ? new Date(cursor.value)
          : new Date(Date.now() - 24 * 60 * 60 * 1000);

  // balances universe
  const balances = (await prisma.inventoryBalance.findMany({
    select: {
      cardmarketId: true,
      isFoil: true,
      condition: true,
      language: true,
      qtyOnHand: true,
    },
  })) as Bal[];

  const cmIds = Array.from(
    new Set(balances.map((b) => Number(b.cardmarketId)).filter(Number.isFinite))
  ) as number[];

  if (!cmIds.length) {
    return new Response(
      "cardmarketId,isFoil,condition,language,addQty,priceEur,policyName,sourceCode,stockClass,location,comment\n",
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="post-sales-${channel}-${Date.now()}.csv"`,
        },
      }
    );
  }

  // ---- stockClass map in bulk ----
  // ScryfallLookup => StockPolicy => default REGULAR
  const lookups = await prisma.scryfallLookup.findMany({
    where: { cardmarketId: { in: cmIds } },
    select: { cardmarketId: true, scryfallId: true },
  });

  const scryByCmid = new Map<number, string>();
  const scryIds = new Set<string>();

  for (const l of lookups) {
    if (l.scryfallId) {
      const cmid = Number(l.cardmarketId);
      scryByCmid.set(cmid, l.scryfallId);
      scryIds.add(l.scryfallId);
    }
  }

  const policies = await prisma.stockPolicy.findMany({
    where: { scryfallId: { in: Array.from(scryIds) } },
    select: { scryfallId: true, stockClass: true },
  });

  const classByScry = new Map<string, string>();
  for (const p of policies) classByScry.set(p.scryfallId, String(p.stockClass));

  const stockClassByCmid = new Map<number, string>();
  for (const cmid of cmIds) {
    const scry = scryByCmid.get(cmid);
    const sc = scry ? (classByScry.get(scry) ?? "REGULAR") : "REGULAR";
    stockClassByCmid.set(cmid, sc);
  }

 // ---- soldMap in bulk (only when needed) ----
const soldMap = new Map<string, number>();
if (mode === "relist") {
  type Row = { cardmarketId: number; isFoil: boolean; condition: string; language: string; sum: any };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `
    SELECT
      "cardmarketId",
      COALESCE("isFoil", false) AS "isFoil",
      ${normCondSql(`"condition"`)} AS "condition",
      ${normLangSql(`"language"`)} AS "language",
      COALESCE(SUM(qty),0) AS sum
    FROM "SalesLog"
    WHERE "inventoryAppliedAt" IS NOT NULL
      AND ts >= $1
    GROUP BY 1,2,3,4
    `,
    effectiveSince as any
  );

  for (const r of rows) {
    const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
    soldMap.set(key, Math.abs(Number(r.sum || 0)));
  }
}


 // ---- newStockMap in bulk (only when needed) ----
const newStockMap = new Map<string, number>();
if (mode === "newstock") {
  type Row = { cardmarketId: number; isFoil: boolean; condition: string; language: string; sum: any };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `
    SELECT
      "cardmarketId",
      COALESCE("isFoil", false) AS "isFoil",
      ${normCondSql(`"condition"`)} AS "condition",
      ${normLangSql(`"language"`)} AS "language",
      COALESCE(SUM("qtyRemaining"),0) AS sum
    FROM "InventoryLot"
    WHERE "sourceDate" >= $1
      AND "qtyRemaining" > 0
    GROUP BY 1,2,3,4
    `,
    effectiveSince as any
  );

  for (const r of rows) {
    const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
    newStockMap.set(key, Math.abs(Number(r.sum || 0)));
  }
}


  // ---- cmTrendMap in bulk ----
  const cmTrendMap = new Map<number, number>();
  {
    const rows = await prisma.$queryRawUnsafe<{ cardmarketId: number; trend: any | null }[]>(
      `SELECT "cardmarketId","trend" FROM "CMPriceGuide" WHERE "cardmarketId" = ANY($1)`,
      cmIds
    );
    for (const r of rows) if (r.trend != null) cmTrendMap.set(Number(r.cardmarketId), Number(r.trend));
  }

  // ---- CT min maps ----
  const mapRows = await prisma.$queryRawUnsafe<{ cardmarketId: number; blueprintId: number | null }[]>(
    `SELECT "cardmarketId","blueprintId" FROM "BlueprintMapping" WHERE "cardmarketId" = ANY($1)`,
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

  const ctMinMap = new Map<number, number>();
  if (bpIds.size) {
    const bpArr = Array.from(bpIds) as number[];
    const rows = await prisma.cTMarketSummary.findMany({
      where: { blueprintId: { in: bpArr } },
      select: { blueprintId: true, minPrice: true },
    });
    const ctByBp = new Map<number, number>();
    for (const r of rows) if (r.minPrice != null) ctByBp.set(Number(r.blueprintId), Number(r.minPrice));
    for (const [cmid, bp] of bpByCmid.entries()) {
      const v = ctByBp.get(bp);
      if (v != null) ctMinMap.set(cmid, v);
    }
  }

  const ctMinByCond = new Map<string, number>(); // cmid|foil|bucket
  {
    type CtRow = { cardmarketId: number; isFoil: boolean; bucket: string; minPrice: number | null };
    const rows = await prisma.$queryRawUnsafe<CtRow[]>(
      `SELECT "cardmarketId","isFoil","bucket","minPrice" FROM "CTMarketLatest" WHERE "cardmarketId" = ANY($1)`,
      cmIds
    );

    for (const r of rows) {
      if (r.minPrice == null) continue;
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${(r.bucket || "").toUpperCase()}`;
      const val = Number(r.minPrice);
      const existing = ctMinByCond.get(key);
      if (existing == null || val < existing) ctMinByCond.set(key, val);
    }
  }

  // ---- First lot meta in bulk (FIFO) ----
  // FILTERED on cmIds for performance
  const firstLotMap = new Map<string, { sourceCode: string | null; location: string | null }>();
  {
    type Row = {
      cardmarketId: number;
      isFoil: boolean;
      condition: string;
      language: string;
      sourceCode: string | null;
      location: string | null;
    };

    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `
      SELECT DISTINCT ON ("cardmarketId", COALESCE("isFoil",false), ${normCondSql(`"condition"`)}, ${normLangSql(`"language"`)})
        "cardmarketId",
        COALESCE("isFoil", false) AS "isFoil",
        ${normCondSql(`"condition"`)} AS "condition",
        ${normLangSql(`"language"`)} AS "language",
        "sourceCode",
        "location"
      FROM "InventoryLot"
      WHERE "cardmarketId" = ANY($1)
        AND "qtyRemaining" > 0
        AND "location" IS NOT NULL
      ORDER BY
        "cardmarketId",
        COALESCE("isFoil",false),
        ${normCondSql(`"condition"`)},
        ${normLangSql(`"language"`)},
        "sourceDate" ASC,
        "createdAt" ASC
      `,
      cmIds
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      firstLotMap.set(key, { sourceCode: r.sourceCode ?? null, location: r.location ?? null });
    }
  }

  // ---- Last sold price in bulk (only for relist mode) ----
  const lastSoldPriceMap = new Map<string, number>();
  if (mode === "relist") {
    type Row = {
      cardmarketId: number;
      isFoil: boolean;
      condition: string;
      language: string;
      unitPriceEur: number | null;
      lineTotalEur: number | null;
      qty: number | null;
    };

    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `
      SELECT DISTINCT ON ("cardmarketId", COALESCE("isFoil",false), ${normCondSql(`"condition"`)}, ${normLangSql(`"language"`)})
        "cardmarketId",
        COALESCE("isFoil", false) AS "isFoil",
        ${normCondSql(`"condition"`)} AS "condition",
        ${normLangSql(`"language"`)} AS "language",
        "unitPriceEur",
        "lineTotalEur",
        "qty"
      FROM "SalesLog"
      WHERE "inventoryAppliedAt" IS NOT NULL
        AND ts >= $1
      ORDER BY
        "cardmarketId",
        COALESCE("isFoil",false),
        ${normCondSql(`"condition"`)},
        ${normLangSql(`"language"`)},
        ts DESC
      `,
      effectiveSince as any
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      let price: number | null = null;
      if (r.unitPriceEur != null) price = Number(r.unitPriceEur);
      else if (r.lineTotalEur != null && r.qty) price = Number(r.lineTotalEur) / Math.abs(Number(r.qty));
      if (price != null && price > 0) lastSoldPriceMap.set(key, price);
    }
  }

  // ---- policy (only needed for CM) ----
  const needsPolicy = channel === "CM";
  const policy = needsPolicy
    ? await prisma.listPolicy.findFirst({
        where: { channel: "CM", enabled: true },
        include: { tiers: { orderBy: { minOnHand: "desc" } } },
      })
    : null;

  if (needsPolicy && !policy) {
    return new Response("No enabled ListPolicy for CM channel", { status: 400 });
  }

  const header =
    "cardmarketId,isFoil,condition,language,addQty,priceEur,policyName,sourceCode,stockClass,location,comment\n";
  const lines: string[] = [header];

  for (const b of balances) {
    if (b.qtyOnHand <= 0) continue;

    const cond = (b.condition || "NM").toUpperCase();
    const lang = (b.language || "EN").toUpperCase();
    const key = `${b.cardmarketId}|${b.isFoil ? 1 : 0}|${cond}|${lang}`;

    const sc = stockClassByCmid.get(b.cardmarketId) ?? "REGULAR";

    // channel filters
    if (channel === "CM") {
      if (sc === "CTBULK") continue;
    } else if (channel === "CTBULK") {
      if (sc !== "CTBULK") continue;
    }

    const soldSince = soldMap.get(key) || 0;
    const newSince = newStockMap.get(key) || 0;

    let addQty = 0;

    if (channel === "CTBULK") {
      if (mode === "full") {
        addQty = Math.max(0, b.qtyOnHand);
      } else if (mode === "newstock") {
        if (newSince <= 0) continue;
        addQty = Math.min(newSince, b.qtyOnHand);
      } else {
        if (soldSince <= 0) continue;
        addQty = Math.min(soldSince, b.qtyOnHand);
      }
    } else {
      // CM: jouw tiers/caps
      if (!policy) continue;

      if (mode === "full") {
  // ✅ CM snapshot: desired listing qty op basis van huidige onHand + tier cap
  const tierNow = policy.tiers.find((t) => b.qtyOnHand >= t.minOnHand) || null;
  const capNow = tierNow?.listQty ?? 0;

  // "desired online" = min(capNow, qtyOnHand)
  addQty = Math.max(0, Math.min(capNow, b.qtyOnHand));
  if (addQty <= 0) continue;
} else if (mode === "relist") {
  if (soldSince <= 0) continue;

  const tierNow = policy.tiers.find((t) => b.qtyOnHand >= t.minOnHand) || null;
  const capNow = tierNow?.listQty ?? 0;

  addQty = Math.max(0, Math.min(soldSince, capNow, b.qtyOnHand));
} else {
  // newstock
  if (newSince <= 0) continue;

  const tierNow = policy.tiers.find((t) => b.qtyOnHand >= t.minOnHand) || null;
  const capNow = tierNow?.listQty ?? 0;

  const oldOnHand = Math.max(0, b.qtyOnHand - newSince);
  const tierOld = policy.tiers.find((t) => oldOnHand >= t.minOnHand) || null;
  const capOld = tierOld?.listQty ?? 0;

  const desiredNow = Math.min(capNow, b.qtyOnHand);
  const desiredOld = Math.min(capOld, oldOnHand);

  const extraNeeded = Math.max(0, desiredNow - desiredOld);
  addQty = Math.max(0, Math.min(extraNeeded, newSince, b.qtyOnHand));
}


      if (mode === "relist") {
        if (soldSince <= 0) continue;

        const tierNow = policy.tiers.find((t) => b.qtyOnHand >= t.minOnHand) || null;
        const capNow = tierNow?.listQty ?? 0;

        addQty = Math.max(0, Math.min(soldSince, capNow, b.qtyOnHand));
      } else {
        // newstock
        if (newSince <= 0) continue;

        const tierNow = policy.tiers.find((t) => b.qtyOnHand >= t.minOnHand) || null;
        const capNow = tierNow?.listQty ?? 0;

        const oldOnHand = Math.max(0, b.qtyOnHand - newSince);
        const tierOld = policy.tiers.find((t) => oldOnHand >= t.minOnHand) || null;
        const capOld = tierOld?.listQty ?? 0;

        const desiredNow = Math.min(capNow, b.qtyOnHand);
        const desiredOld = Math.min(capOld, oldOnHand);

        const extraNeeded = Math.max(0, desiredNow - desiredOld);
        addQty = Math.max(0, Math.min(extraNeeded, newSince, b.qtyOnHand));
      }
    }

    if (addQty <= 0) continue;

    // pricing
    let price: number | null = null;

    if (mode === "relist") {
      const last = lastSoldPriceMap.get(key) ?? null;

      if (last != null && last > 0) {
        price = last * (1 + (isFinite(markupPct) ? markupPct : 0.05));
      } else {
        const cmTrend = cmTrendMap.get(b.cardmarketId) ?? null;

        const bucket = conditionToCtBucket(cond);
        const ctKey = `${b.cardmarketId}|${b.isFoil ? 1 : 0}|${bucket}`;
        const ctMinByBucket = ctMinByCond.get(ctKey) ?? null;

        const ctMinGlobal = ctMinMap.get(b.cardmarketId) ?? null;
        const ctMin = ctMinByBucket ?? ctMinGlobal;

        if (cmTrend != null || ctMin != null) {
          const base = ctMin ?? (cmTrend ?? 0) * 1.10;
          price = base;
        }
      }
    } else {
      // newstock or full
      const cmTrend = cmTrendMap.get(b.cardmarketId) ?? null;

      const bucket = conditionToCtBucket(cond);
      const ctKey = `${b.cardmarketId}|${b.isFoil ? 1 : 0}|${bucket}`;
      const ctMinByBucket = ctMinByCond.get(ctKey) ?? null;

      const ctMinGlobal = ctMinMap.get(b.cardmarketId) ?? null;
      const ctMin = ctMinByBucket ?? ctMinGlobal;

      if (cmTrend != null || ctMin != null) {
        const base = Math.max(ctMin ?? 0, (cmTrend ?? 0) * 1.10);
        price = base;
      } else {
        price = 1000;
      }
    }

    const step = Number(policy?.roundingStepEur ?? 0.05) || 0.05;
    if (price != null && price > 0) price = roundStep(price, step);
    if (price == null || !(price > 0)) continue;

    const meta = firstLotMap.get(key) ?? { sourceCode: null, location: null };

    // CTBULK: strict meta nodig voor bruikbare export
    if (channel === "CTBULK") {
      if (!meta.location || !meta.sourceCode) continue;
    }

    const comment = buildComment(channel, meta.location, meta.sourceCode);
    const policyName = channel === "CTBULK" ? "CTBULK" : (policy?.name ?? "");

    lines.push(
      [
        csvEscape(b.cardmarketId),
        csvEscape(b.isFoil),
        csvEscape(cond),
        csvEscape(lang),
        csvEscape(addQty),
        csvEscape(price.toFixed(2)),
        csvEscape(policyName),
        csvEscape(meta.sourceCode ?? ""),
        csvEscape(sc),
        csvEscape(meta.location ?? ""),
        csvEscape(comment),
      ].join(",") + "\n"
    );
  }

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
      "Content-Disposition": `attachment; filename="post-sales-${channel}-${Date.now()}.csv"`,
    },
  });
}
