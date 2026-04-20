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

function buildComment(location: string | null, sourceCode: string | null) {
  const src = (sourceCode ?? "").trim();
  return `Tracked letter NL 4,- EU 5,- | Free shipping on orders over 75,- | ${src}`.trim();
}

function normalizeMode(raw: string) {
  const m = (raw || "relist").toLowerCase();
  if (m === "full" || m === "newstock" || m === "relist") return m;
  return "relist";
}

function cursorKeyFor(mode: string) {
  const m = mode.toLowerCase();
  return `cm.${m}.lastExportAt`;
}

function getMarketFloorPrice(cmTrend: number | null, ctMin: number | null) {
  const hasCt = ctMin != null && Number.isFinite(ctMin) && ctMin > 0;
  const hasCm = cmTrend != null && Number.isFinite(cmTrend) && cmTrend > 0;

  if (hasCt && hasCm) return Math.max(ctMin as number, (cmTrend as number) * 1.1);
  if (hasCt) return ctMin as number;
  if (hasCm) return (cmTrend as number) * 1.1;
  return null;
}

type PolicyTier = {
  minOnHand: number;
  listQty: number;
};

type PolicyWithTiers = {
  id: number;
  name: string;
  channel: string;
  priceSource: string;
  roundingStepEur: unknown;
  enabled: boolean;
  tiers: PolicyTier[];
};

function getBaseCap(policy: PolicyWithTiers, qty: number) {
  const tier = policy.tiers.find((t) => qty >= t.minOnHand) || null;
  return tier?.listQty ?? 0;
}

function applyPlaysetPremium(params: {
  baseCap: number;
  qty: number;
  isFoil: boolean;
  tix: number | null | undefined;
}) {
  const { baseCap, qty, isFoil, tix } = params;
  if (isFoil) return baseCap;
  if (qty < 4) return baseCap;
  if (tix == null || !(tix > 3)) return baseCap;
  return Math.max(baseCap, 4);
}

function getFinalCap(policy: PolicyWithTiers, qty: number, isFoil: boolean, tix: number | null | undefined) {
  const baseCap = getBaseCap(policy, qty);
  return applyPlaysetPremium({ baseCap, qty, isFoil, tix });
}

type Bal = {
  cardmarketId: number;
  isFoil: boolean;
  condition: string;
  language: string;
  qtyOnHand: number;
};

type LookupRow = {
  cardmarketId: number;
  scryfallId: string | null;
  oracleId: string | null;
  tix: number | null;
};

type FallbackRow = {
  scryfallId: string;
  oracleId: string | null;
  tix: number | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const mode = normalizeMode(url.searchParams.get("mode") || "relist");
  const markupPct = Number(url.searchParams.get("markupPct") || "0.05");
  const noCursor = url.searchParams.get("noCursor") === "1";
  const sinceParam = url.searchParams.get("since");

  const cursorKey = cursorKeyFor(mode);
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

  const header =
    "cardmarketId,isFoil,condition,language,addQty,priceEur,policyName,sourceCode,location,comment\n";

  if (!cmIds.length) {
    return new Response(header, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="post-sales-cm-${Date.now()}.csv"`,
      },
    });
  }

  const policyRaw = await prisma.listPolicy.findFirst({
    where: { channel: "CM", enabled: true },
    include: { tiers: { orderBy: { minOnHand: "desc" } } },
  });

  if (!policyRaw) {
    return new Response("No enabled ListPolicy for CM channel", { status: 400 });
  }

  const policy = policyRaw as unknown as PolicyWithTiers;

  const lines: string[] = [header];

  // ---- soldMap in bulk (used for relist) ----
  const soldMap = new Map<string, number>();
  if (mode === "relist") {
    type Row = { cardmarketId: number; isFoil: boolean; condition: string; language: string; sum: unknown };
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
      effectiveSince as unknown
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      soldMap.set(key, Math.abs(Number(r.sum || 0)));
    }
  }

  // ---- CM eligible qty map (all non-CB locations) ----
  const cmQtyMap = new Map<string, number>();
  {
    type Row = { cardmarketId: number; isFoil: boolean; condition: string; language: string; sum: unknown };
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
        AND "location" NOT LIKE 'CB-%'
      GROUP BY 1,2,3,4
      `,
      cmIds
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      cmQtyMap.set(key, Math.abs(Number(r.sum || 0)));
    }
  }

  // ---- newStockMap CM (all non-CB locations) ----
  const newStockMap = new Map<string, number>();
  if (mode === "newstock") {
    type Row = { cardmarketId: number; isFoil: boolean; condition: string; language: string; sum: unknown };
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
        AND "location" NOT LIKE 'CB-%'
      GROUP BY 1,2,3,4
      `,
      effectiveSince as unknown
    );

    for (const r of rows) {
      const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}|${r.language}`;
      newStockMap.set(key, Math.abs(Number(r.sum || 0)));
    }
  }

  // ---- cmTrendMap ----
  const cmTrendMap = new Map<number, number>();
  {
    const rows = await prisma.$queryRawUnsafe<{ cardmarketId: number; trend: unknown | null }[]>(
      `SELECT "cardmarketId","trend" FROM "CMPriceGuide" WHERE "cardmarketId" = ANY($1)`,
      cmIds
    );
    for (const r of rows) {
      if (r.trend != null) cmTrendMap.set(Number(r.cardmarketId), Number(r.trend));
    }
  }

  // ---- Blueprint / CT min maps (pricing only) ----
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

  // ---- first CM meta map (all non-CB locations) ----
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
        AND "location" NOT LIKE 'CB-%'
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
      firstCmLotMap.set(key, { sourceCode: r.sourceCode ?? null, location: r.location ?? null });
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
        ${normCondSql(`"condition"`)},
        ${normLangSql(`"language"`)},
        ts DESC
      `,
      effectiveSince as unknown
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

  // ---- tix map (direct lookup, then fallback) ----
  const tixMap = new Map<number, number>();
  {
    const lookupRows = await prisma.$queryRawUnsafe<LookupRow[]>(
      `SELECT "cardmarketId","scryfallId","oracleId","tix" FROM "ScryfallLookup" WHERE "cardmarketId" = ANY($1)`,
      cmIds
    );

    const missingScryfallIds = new Set<string>();
    const missingOracleIds = new Set<string>();
    const lookupByCardmarketId = new Map<number, LookupRow>();

    for (const row of lookupRows) {
      lookupByCardmarketId.set(Number(row.cardmarketId), row);

      if (row.tix != null && Number(row.tix) > 0) {
        tixMap.set(Number(row.cardmarketId), Number(row.tix));
      } else {
        if (row.scryfallId) missingScryfallIds.add(row.scryfallId);
        if (row.oracleId) missingOracleIds.add(row.oracleId);
      }
    }

    if (missingScryfallIds.size || missingOracleIds.size) {
      const sfIds = Array.from(missingScryfallIds);
      const orIds = Array.from(missingOracleIds);

      let fallbackRows: FallbackRow[] = [];

      if (sfIds.length && orIds.length) {
        fallbackRows = await prisma.$queryRawUnsafe<FallbackRow[]>(
          `
          SELECT "scryfallId","oracleId","tix"
          FROM "ScryfallTixFallback"
          WHERE "scryfallId" = ANY($1)
             OR "oracleId" = ANY($2)
          `,
          sfIds,
          orIds
        );
      } else if (sfIds.length) {
        fallbackRows = await prisma.$queryRawUnsafe<FallbackRow[]>(
          `
          SELECT "scryfallId","oracleId","tix"
          FROM "ScryfallTixFallback"
          WHERE "scryfallId" = ANY($1)
          `,
          sfIds
        );
      } else if (orIds.length) {
        fallbackRows = await prisma.$queryRawUnsafe<FallbackRow[]>(
          `
          SELECT "scryfallId","oracleId","tix"
          FROM "ScryfallTixFallback"
          WHERE "oracleId" = ANY($1)
          `,
          orIds
        );
      }

      const fallbackByScryfallId = new Map<string, number>();
      const fallbackByOracleId = new Map<string, number>();

      for (const row of fallbackRows) {
        const tix = row.tix != null ? Number(row.tix) : null;
        if (!(tix != null && tix > 0)) continue;

        if (row.scryfallId && !fallbackByScryfallId.has(row.scryfallId)) {
          fallbackByScryfallId.set(row.scryfallId, tix);
        }
        if (row.oracleId && !fallbackByOracleId.has(row.oracleId)) {
          fallbackByOracleId.set(row.oracleId, tix);
        }
      }

      for (const [cardmarketId, row] of lookupByCardmarketId.entries()) {
        if (tixMap.has(cardmarketId)) continue;

        const fallbackTix =
          (row.scryfallId ? fallbackByScryfallId.get(row.scryfallId) : undefined) ??
          (row.oracleId ? fallbackByOracleId.get(row.oracleId) : undefined);

        if (fallbackTix != null && fallbackTix > 0) {
          tixMap.set(cardmarketId, fallbackTix);
        }
      }
    }
  }

  // ---- CM flow only ----
  for (const b of balances) {
    if (b.qtyOnHand <= 0) continue;

    const cond = (b.condition || "NM").toUpperCase();
    const lang = (b.language || "EN").toUpperCase();
    const key = `${b.cardmarketId}|${b.isFoil ? 1 : 0}|${cond}|${lang}`;

    const cmEligibleQty = cmQtyMap.get(key) ?? 0;
    if (cmEligibleQty <= 0) continue;

    const soldSince = soldMap.get(key) || 0;
    const newSince = newStockMap.get(key) || 0;
    const tix = tixMap.get(Number(b.cardmarketId)) ?? null;

    let addQty = 0;

    if (mode === "full") {
      const capNow = getFinalCap(policy, cmEligibleQty, b.isFoil, tix);
      addQty = Math.max(0, Math.min(capNow, cmEligibleQty));
      if (addQty <= 0) continue;
    } else if (mode === "relist") {
      if (soldSince <= 0) continue;

      const capNow = getFinalCap(policy, cmEligibleQty, b.isFoil, tix);
      addQty = Math.max(0, Math.min(soldSince, capNow, cmEligibleQty));
    } else {
      if (newSince <= 0) continue;

      const capNow = getFinalCap(policy, cmEligibleQty, b.isFoil, tix);
      const oldOnHand = Math.max(0, cmEligibleQty - newSince);
      const capOld = getFinalCap(policy, oldOnHand, b.isFoil, tix);

      const desiredNow = Math.min(capNow, cmEligibleQty);
      const desiredOld = Math.min(capOld, oldOnHand);

      const extraNeeded = Math.max(0, desiredNow - desiredOld);
      addQty = Math.max(0, Math.min(extraNeeded, newSince, cmEligibleQty));
    }

    if (addQty <= 0) continue;

    const cmTrend = cmTrendMap.get(Number(b.cardmarketId)) ?? null;
    const bucket = conditionToCtBucket(cond);
    const ctKey = `${b.cardmarketId}|${b.isFoil ? 1 : 0}|${bucket}`;
    const ctMinByBucket = ctMinByCond.get(ctKey) ?? null;
    const ctMinGlobal = ctMinMap.get(Number(b.cardmarketId)) ?? null;
    const ctMin = ctMinByBucket ?? ctMinGlobal;

    let price: number | null = null;

    if (mode === "relist") {
      const last = lastSoldPriceMap.get(key) ?? null;

      if (last != null && last > 0) {
        price = last * (1 + (Number.isFinite(markupPct) ? markupPct : 0.05));
      } else {
        price = getMarketFloorPrice(cmTrend, ctMin);
      }
    } else {
      price = getMarketFloorPrice(cmTrend, ctMin);
    }

    if (price == null || !(price > 0)) continue;

    const step = Number(policy.roundingStepEur ?? 0.05) || 0.05;
    price = roundStep(price, step);

    const meta = firstCmLotMap.get(key) ?? { sourceCode: null, location: null };
    const comment = buildComment(meta.location, meta.sourceCode);

    lines.push(
      [
        csvEscape(b.cardmarketId),
        csvEscape(b.isFoil),
        csvEscape(cond),
        csvEscape(lang),
        csvEscape(addQty),
        csvEscape(price.toFixed(2)),
        csvEscape(policy.name ?? "CM"),
        csvEscape(meta.sourceCode ?? ""),
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
      "Content-Disposition": `attachment; filename="post-sales-cm-${Date.now()}.csv"`,
    },
  });
}