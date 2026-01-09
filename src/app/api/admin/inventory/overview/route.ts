import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type InventoryRow = {
  id: number;
  cardmarketId: number;
  isFoil: boolean;
  condition: string;
  language: string | null;
  qtyOnHand: number;
  avgUnitCostEur: number | null;
  lastSaleAt: string | null;
  name: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;
  sourceCode: string | null;
  cmTrendEur: number | null;
  ctMinEur: number | null;
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const search = (url.searchParams.get("search") || "").trim();
    const includeZero = url.searchParams.get("includeZero") === "1";
    const sourceFilter = (url.searchParams.get("source") || "").trim();
    const setFilter = (url.searchParams.get("set") || "").trim().toUpperCase();
    const onlyPlayed = url.searchParams.get("onlyPlayed") === "1";

    // ⭐ default UIT, want CT-min aggregatie maakt alles extreem traag
    const includeCt = url.searchParams.get("includeCt") === "1";

    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const pageSize = Math.max(
      10,
      Math.min(Number(url.searchParams.get("pageSize") || "50"), 100)
    );
    const offset = (page - 1) * pageSize;

    // CT join alleen als includeCt=1
    const ctJoin = includeCt
      ? `
      LEFT JOIN (
        SELECT
          bm."cardmarketId",
          MIN(ct."minPrice") AS "ctMinEur"
        FROM "BlueprintMapping" bm
        JOIN "CTMarketSummary" ct
          ON ct."blueprintId" = bm."blueprintId"
        GROUP BY bm."cardmarketId"
      ) ct
        ON ct."cardmarketId" = b."cardmarketId"
      `
      : "";

    const ctSelect = includeCt
      ? `ct."ctMinEur" AS "ctMinEur"`
      : `NULL::numeric AS "ctMinEur"`;

    const items = await prisma.$queryRawUnsafe<InventoryRow[]>(
      `
      SELECT
        b.id,
        b."cardmarketId",
        b."isFoil",
        b."condition",
        b."language",
        b."qtyOnHand",
        b."avgUnitCostEur",
        b."lastSaleAt",
        sf."name",
        sf."set" AS "setCode",
        sf."collectorNumber",
        sf."imageSmall" AS "imageUrl",

        firstlot."sourceCode" AS "sourceCode",

        pg."trend" AS "cmTrendEur",
        ${ctSelect}

      FROM "InventoryBalance" b
      LEFT JOIN "ScryfallLookup" sf
        ON sf."cardmarketId" = b."cardmarketId"

      -- sneller dan correlated subquery (FIFO eerste lot)
      LEFT JOIN LATERAL (
        SELECT l."sourceCode"
        FROM "InventoryLot" l
        WHERE l."cardmarketId" = b."cardmarketId"
          AND l."isFoil" = b."isFoil"
          AND l."condition" = b."condition"
          AND l."language" = b."language"
          AND l."qtyRemaining" > 0
        ORDER BY l."sourceDate" ASC, l."createdAt" ASC
        LIMIT 1
      ) firstlot ON true

      LEFT JOIN "CMPriceGuide" pg
        ON pg."cardmarketId" = b."cardmarketId"

      ${ctJoin}

      WHERE
        ($1::boolean OR b."qtyOnHand" > 0)
        AND (
          $2 = '' OR
          sf."name" ILIKE '%' || $2 || '%' OR
          CAST(b."cardmarketId" AS TEXT) = $2
        )
        AND (
          $3 = '' OR EXISTS (
            SELECT 1
            FROM "InventoryLot" l
            WHERE l."cardmarketId" = b."cardmarketId"
              AND l."isFoil" = b."isFoil"
              AND l."condition" = b."condition"
              AND l."language" = b."language"
              AND l."sourceCode" ILIKE '%' || $3 || '%'
          )
        )
        AND (
          $4 = '' OR UPPER(COALESCE(sf."set", '')) = $4
        )
        AND (
          NOT $5::boolean
          OR b."condition" IN ('GD','LP','PL','PO')
        )

      ORDER BY
        sf."name" NULLS LAST,
        b."cardmarketId",
        b."isFoil" DESC,
        b."condition"

      LIMIT $6 OFFSET $7
      `,
      includeZero,  // $1
      search,       // $2
      sourceFilter, // $3
      setFilter,    // $4
      onlyPlayed,   // $5
      pageSize,     // $6
      offset        // $7
    );

    // ✅ LEAN count (geen CMPriceGuide/CT join nodig)
    const totalRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `
      SELECT COUNT(*)::bigint AS count
      FROM "InventoryBalance" b
      LEFT JOIN "ScryfallLookup" sf
        ON sf."cardmarketId" = b."cardmarketId"
      WHERE
        ($1::boolean OR b."qtyOnHand" > 0)
        AND (
          $2 = '' OR
          sf."name" ILIKE '%' || $2 || '%' OR
          CAST(b."cardmarketId" AS TEXT) = $2
        )
        AND (
          $3 = '' OR EXISTS (
            SELECT 1
            FROM "InventoryLot" l
            WHERE l."cardmarketId" = b."cardmarketId"
              AND l."isFoil" = b."isFoil"
              AND l."condition" = b."condition"
              AND l."language" = b."language"
              AND l."sourceCode" ILIKE '%' || $3 || '%'
          )
        )
        AND (
          $4 = '' OR UPPER(COALESCE(sf."set", '')) = $4
        )
        AND (
          NOT $5::boolean
          OR b."condition" IN ('GD','LP','PL','PO')
        )
      `,
      includeZero,  // $1
      search,       // $2
      sourceFilter, // $3
      setFilter,    // $4
      onlyPlayed    // $5
    );

    const total = Number(totalRows[0]?.count || 0);

    const safeItems = items.map((row) => ({
      ...row,
      id: Number(row.id),
      cardmarketId: Number(row.cardmarketId),
      qtyOnHand: Number(row.qtyOnHand),
      avgUnitCostEur: row.avgUnitCostEur == null ? null : Number(row.avgUnitCostEur),
      cmTrendEur: row.cmTrendEur == null ? null : Number(row.cmTrendEur),
      ctMinEur: row.ctMinEur == null ? null : Number(row.ctMinEur),
    }));

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      items: safeItems,
    });
  } catch (e: any) {
    console.error("inventory overview error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "inventory overview failed" },
      { status: 500 }
    );
  }
}
