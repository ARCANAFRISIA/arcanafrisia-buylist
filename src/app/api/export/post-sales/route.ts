// src/app/api/export/post-sales/route.ts
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
  const src = (sourceCode ?? "").trim();
  const ch = (channel || "CM").toUpperCase();

  if (ch === "CTBULK") {
    return src;
  }

  return `Tracked letter NL 4,- EU 5,- | Free shipping on orders over 75,- | ${src}`.trim();
}

function normalizeChannel(raw: string) {
  const ch = (raw || "CM").toUpperCase();
  if (ch === "CT") return "CTBULK";
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

type LotAggRow = {
  cardmarketId: number;
  isFoil: boolean;
  condition: string;
  language: string;
  sourceCode: string;
  location: string;
  qty: any;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const channel = normalizeChannel(url.searchParams.get("channel") || "CM");
  const mode = normalizeMode(url.searchParams.get("mode") || "relist");
  const markupPct = Number(url.searchParams.get("markupPct") || "0.05");

  const noCursor = url.searchParams.get("noCursor") === "1";
  const sinceParam = url.searchParams.get("since");
  const physical = url.searchParams.get("physical") === "1";

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

  const header =
    "cardmarketId,isFoil,condition,language,addQty,priceEur,policyName,sourceCode,stockClass,location,comment\n";
  const lines: string[] = [header];

  // ---- soldMap in bulk (used for relist) ----
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

  // ---- CM eligible qty map (only PM-*-EX / PM-*-GD) ----
  const cmQtyMap = new Map<string, number>();
  {
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
      WHERE "cardmarketId" = ANY($1)
        AND "qtyRemaining" > 0
        AND "location" IS NOT NULL
        AND (
          "location" LIKE 'PM-%-EX'
          OR "location" LIKE 'PM-%-GD'
        )
      GROUP BY 1,2,3,4
      `,
      cmIds
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      cmQtyMap.set(key, Math.abs(Number(r.sum || 0)));
    }
  }

  // ---- CT eligible qty map (only CB- locations) ----
  const ctQtyMap = new Map<string, number>();
  {
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
      WHERE "cardmarketId" = ANY($1)
        AND "qtyRemaining" > 0
        AND "location" IS NOT NULL
        AND "location" LIKE 'CB-%'
      GROUP BY 1,2,3,4
      `,
      cmIds
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      ctQtyMap.set(key, Math.abs(Number(r.sum || 0)));
    }
  }

  // ---- newStockMap CM ----
  const newStockMapCM = new Map<string, number>();
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
        AND "location" IS NOT NULL
        AND (
          "location" LIKE 'PM-%-EX'
          OR "location" LIKE 'PM-%-GD'
        )
      GROUP BY 1,2,3,4
      `,
      effectiveSince as any
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      newStockMapCM.set(key, Math.abs(Number(r.sum || 0)));
    }
  }

  // ---- newStockMap CT ----
  const newStockMapCT = new Map<string, number>();
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
        AND "location" IS NOT NULL
        AND "location" LIKE 'CB-%'
      GROUP BY 1,2,3,4
      `,
      effectiveSince as any
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      newStockMapCT.set(key, Math.abs(Number(r.sum || 0)));
    }
  }

  // ---- cmTrendMap ----
  const cmTrendMap = new Map<number, number>();
  {
    const rows = await prisma.$queryRawUnsafe<{ cardmarketId: number; trend: any | null }[]>(
      `SELECT "cardmarketId","trend" FROM "CMPriceGuide" WHERE "cardmarketId" = ANY($1)`,
      cmIds
    );
    for (const r of rows) {
      if (r.trend != null) cmTrendMap.set(Number(r.cardmarketId), Number(r.trend));
    }
  }

  // ---- Blueprint / CT min maps ----
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
    const raw = Array.from(bpIds);
    const bpArr = raw
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && Number.isSafeInteger(n)) as number[];

    if (bpArr.length) {
      const CHUNK = 5000;
      const ctByBp = new Map<number, number>();

      for (let i = 0; i < bpArr.length; i += CHUNK) {
        const chunk = bpArr.slice(i, i + CHUNK);

        const rows = await prisma.$queryRawUnsafe<{ blueprintId: number; minprice: number | null }[]>(
          `
          SELECT "blueprintId", MIN("minPrice") AS minprice
          FROM "CTMarketLatest"
          WHERE "blueprintId" = ANY($1)
            AND "minPrice" IS NOT NULL
          GROUP BY "blueprintId"
          `,
          chunk
        );

        for (const r of rows) {
          if (r.minprice != null) ctByBp.set(Number(r.blueprintId), Number(r.minprice));
        }
      }

      for (const [cmid, bp] of bpByCmid.entries()) {
        const v = ctByBp.get(bp);
        if (v != null) ctMinMap.set(cmid, v);
      }
    }
  }

  const ctMinByCond = new Map<string, number>();
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

  // ---- first CM meta map (only PM core locations) ----
  const firstCmLotMap = new Map<string, { sourceCode: string | null; location: string | null }>();
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
      SELECT DISTINCT ON ("cardmarketId", COALESCE("isFoil",false), ${normCondSql(`"condition"`)}, ${normLangSql(`"language"`)} )
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
        AND (
          "location" LIKE 'PM-%-EX'
          OR "location" LIKE 'PM-%-GD'
        )
      ORDER BY
        "cardmarketId",
        COALESCE("isFoil",false),
        ${normCondSql(`"condition"`)} ,
        ${normLangSql(`"language"`)} ,
        "sourceDate" ASC,
        "createdAt" ASC
      `,
      cmIds
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      firstCmLotMap.set(key, { sourceCode: r.sourceCode ?? null, location: r.location ?? null });
    }
  }

  // ---- first CT meta map (only CB locations) ----
  const firstCtLotMap = new Map<string, { sourceCode: string | null; location: string | null }>();
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
      SELECT DISTINCT ON ("cardmarketId", COALESCE("isFoil",false), ${normCondSql(`"condition"`)}, ${normLangSql(`"language"`)} )
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
        AND "location" LIKE 'CB-%'
      ORDER BY
        "cardmarketId",
        COALESCE("isFoil",false),
        ${normCondSql(`"condition"`)} ,
        ${normLangSql(`"language"`)} ,
        "sourceDate" ASC,
        "createdAt" ASC
      `,
      cmIds
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      firstCtLotMap.set(key, { sourceCode: r.sourceCode ?? null, location: r.location ?? null });
    }
  }

  // ---- last sold price map ----
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
      SELECT DISTINCT ON ("cardmarketId", COALESCE("isFoil",false), ${normCondSql(`"condition"`)}, ${normLangSql(`"language"`)} )
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
        ${normCondSql(`"condition"`)} ,
        ${normLangSql(`"language"`)} ,
        ts DESC
      `,
      effectiveSince as any
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      let price: number | null = null;

      if (r.unitPriceEur != null) {
        price = Number(r.unitPriceEur);
      } else if (r.lineTotalEur != null && r.qty) {
        price = Number(r.lineTotalEur) / Math.abs(Number(r.qty));
      }

      if (price != null && price > 0) lastSoldPriceMap.set(key, price);
    }
  }

  // ---- policy (CM only) ----
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

  // ---- CTBULK lot-based rows (only CB locations) ----
  let ctbulkRows: LotAggRow[] = [];
  if (channel === "CTBULK") {
    const whereSince = mode === "newstock" ? `AND "sourceDate" >= $1` : ``;
    const params: any[] = mode === "newstock" ? [effectiveSince] : [];

    ctbulkRows = await prisma.$queryRawUnsafe<LotAggRow[]>(
      `
      SELECT
        "cardmarketId",
        COALESCE("isFoil", false) AS "isFoil",
        ${normCondSql(`"condition"`)} AS "condition",
        ${normLangSql(`"language"`)} AS "language",
        "sourceCode",
        "location",
        COALESCE(SUM("qtyRemaining"),0) AS qty
      FROM "InventoryLot"
      WHERE "qtyRemaining" > 0
        AND "location" IS NOT NULL
        AND "sourceCode" IS NOT NULL
        AND "location" LIKE 'CB-%'
        ${whereSince}
      GROUP BY 1,2,3,4,5,6
      HAVING COALESCE(SUM("qtyRemaining"),0) > 0
      ORDER BY "cardmarketId","isFoil","condition","language","location","sourceCode"
      `,
      ...params
    );
  }

  // ---- CM physical lot-based rows (only PM core locations) ----
  let cmPhysicalRows: LotAggRow[] = [];
  if (channel === "CM" && mode === "full" && physical) {
    cmPhysicalRows = await prisma.$queryRawUnsafe<LotAggRow[]>(
      `
      SELECT
        "cardmarketId",
        COALESCE("isFoil", false) AS "isFoil",
        ${normCondSql(`"condition"`)} AS "condition",
        ${normLangSql(`"language"`)} AS "language",
        "sourceCode",
        "location",
        COALESCE(SUM("qtyRemaining"),0) AS qty
      FROM "InventoryLot"
      WHERE "qtyRemaining" > 0
        AND "location" IS NOT NULL
        AND "sourceCode" IS NOT NULL
        AND (
          "location" LIKE 'PM-%-EX'
          OR "location" LIKE 'PM-%-GD'
        )
      GROUP BY 1,2,3,4,5,6
      HAVING COALESCE(SUM("qtyRemaining"),0) > 0
      ORDER BY "cardmarketId","isFoil","condition","language","location","sourceCode"
      `
    );
  }

  // ---- CTBULK early return ----
  if (channel === "CTBULK") {
    for (const r of ctbulkRows) {
      const addQty = Number(r.qty || 0);
      if (!(addQty > 0)) continue;

      const cmid = Number(r.cardmarketId);
      const cond = (r.condition || "NM").toUpperCase();
      const lang = (r.language || "EN").toUpperCase();

      let price: number | null = null;

      const cmTrend = cmTrendMap.get(cmid) ?? null;

      const bucket = conditionToCtBucket(cond);
      const ctKey = `${cmid}|${r.isFoil ? 1 : 0}|${bucket}`;
      const ctMinByBucket = ctMinByCond.get(ctKey) ?? null;

      const ctMinGlobal = ctMinMap.get(cmid) ?? null;
      const ctMin = ctMinByBucket ?? ctMinGlobal;

      if (cmTrend != null || ctMin != null) {
        const base = Math.max(ctMin ?? 0, (cmTrend ?? 0) * 1.10);
        price = base;
      } else {
        price = 1000;
      }

      const step = 0.05;
      if (price != null && price > 0) price = roundStep(price, step);
      if (price == null || !(price > 0)) continue;

      const sourceCode = (r.sourceCode ?? "").trim();
      const location = (r.location ?? "").trim();
      if (!sourceCode || !location) continue;

      const comment = buildComment("CTBULK", location, sourceCode);

      lines.push(
        [
          csvEscape(cmid),
          csvEscape(!!r.isFoil),
          csvEscape(cond),
          csvEscape(lang),
          csvEscape(addQty),
          csvEscape(price.toFixed(2)),
          csvEscape("CTBULK"),
          csvEscape(sourceCode),
          csvEscape("CTBULK"),
          csvEscape(location),
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

  // ---- CM physical early return ----
  if (channel === "CM" && mode === "full" && physical) {
    for (const r of cmPhysicalRows) {
      const addQty = Number(r.qty || 0);
      if (!(addQty > 0)) continue;

      const cmid = Number(r.cardmarketId);
      const cond = (r.condition || "NM").toUpperCase();
      const lang = (r.language || "EN").toUpperCase();

      let price: number | null = null;

      const cmTrend = cmTrendMap.get(cmid) ?? null;

      const bucket = conditionToCtBucket(cond);
      const ctKey = `${cmid}|${r.isFoil ? 1 : 0}|${bucket}`;
      const ctMinByBucket = ctMinByCond.get(ctKey) ?? null;

      const ctMinGlobal = ctMinMap.get(cmid) ?? null;
      const ctMin = ctMinByBucket ?? ctMinGlobal;

      if (cmTrend != null || ctMin != null) {
        const base = Math.max(ctMin ?? 0, (cmTrend ?? 0) * 1.10);
        price = base;
      } else {
        price = 1000;
      }

      const step = 0.05;
      if (price != null && price > 0) price = roundStep(price, step);
      if (price == null || !(price > 0)) continue;

      const sourceCode = (r.sourceCode ?? "").trim();
      const location = (r.location ?? "").trim();
      if (!sourceCode || !location) continue;

      const comment = buildComment("CM", location, sourceCode);

      lines.push(
        [
          csvEscape(cmid),
          csvEscape(!!r.isFoil),
          csvEscape(cond),
          csvEscape(lang),
          csvEscape(addQty),
          csvEscape(price.toFixed(2)),
          csvEscape("PM_CORE"),
          csvEscape(sourceCode),
          csvEscape("PM_CORE"),
          csvEscape(location),
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
        "Content-Disposition": `attachment; filename="post-sales-${channel}-full-physical-${Date.now()}.csv"`,
      },
    });
  }

  // ---- CM balance-based flow ----
  for (const b of balances) {
    if (b.qtyOnHand <= 0) continue;

    const cond = (b.condition || "NM").toUpperCase();
    const lang = (b.language || "EN").toUpperCase();
    const key = `${b.cardmarketId}|${b.isFoil ? 1 : 0}|${cond}|${lang}`;

    const cmEligibleQty = cmQtyMap.get(key) ?? 0;
    const ctEligibleQty = ctQtyMap.get(key) ?? 0;

    if (channel === "CM") {
      if (cmEligibleQty <= 0) continue;
    } else if (channel === "CTBULK") {
      if (ctEligibleQty <= 0) continue;
    }

    const soldSince = soldMap.get(key) || 0;
    const newSince = channel === "CM" ? (newStockMapCM.get(key) || 0) : (newStockMapCT.get(key) || 0);

    let addQty = 0;

    if (channel === "CTBULK") {
      if (mode === "full") {
        addQty = Math.max(0, ctEligibleQty);
      } else if (mode === "newstock") {
        if (newSince <= 0) continue;
        addQty = Math.min(newSince, ctEligibleQty);
      } else {
        if (soldSince <= 0) continue;
        addQty = Math.min(soldSince, ctEligibleQty);
      }
    } else {
      if (!policy) continue;

      if (mode === "full") {
        const tierNow = policy.tiers.find((t) => cmEligibleQty >= t.minOnHand) || null;
        const capNow = tierNow?.listQty ?? 0;
        addQty = Math.max(0, Math.min(capNow, cmEligibleQty));
        if (addQty <= 0) continue;
      } else if (mode === "relist") {
        if (soldSince <= 0) continue;

        const tierNow = policy.tiers.find((t) => cmEligibleQty >= t.minOnHand) || null;
        const capNow = tierNow?.listQty ?? 0;

        addQty = Math.max(0, Math.min(soldSince, capNow, cmEligibleQty));
      } else {
        if (newSince <= 0) continue;

        const tierNow = policy.tiers.find((t) => cmEligibleQty >= t.minOnHand) || null;
        const capNow = tierNow?.listQty ?? 0;

        const oldOnHand = Math.max(0, cmEligibleQty - newSince);
        const tierOld = policy.tiers.find((t) => oldOnHand >= t.minOnHand) || null;
        const capOld = tierOld?.listQty ?? 0;

        const desiredNow = Math.min(capNow, cmEligibleQty);
        const desiredOld = Math.min(capOld, oldOnHand);

        const extraNeeded = Math.max(0, desiredNow - desiredOld);
        addQty = Math.max(0, Math.min(extraNeeded, newSince, cmEligibleQty));
      }
    }

    if (addQty <= 0) continue;

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

    const meta =
      channel === "CM"
        ? (firstCmLotMap.get(key) ?? { sourceCode: null, location: null })
        : (firstCtLotMap.get(key) ?? { sourceCode: null, location: null });

    if (channel === "CTBULK") {
      if (!meta.location || !meta.sourceCode) continue;
    }

    const comment = buildComment(channel, meta.location, meta.sourceCode);
    const policyName = channel === "CTBULK" ? "CTBULK" : (policy?.name ?? "");
    const stockClass = channel === "CM" ? "PM_CORE" : "CTBULK";

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
        csvEscape(stockClass),
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