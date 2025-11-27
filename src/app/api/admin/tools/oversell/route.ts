import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: NextRequest) {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      WITH lot_agg AS (
        SELECT
          "cardmarketId",
          "isFoil",
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
          END AS "conditionNorm",
          CASE
            WHEN "language" IS NULL OR "language" = ''  THEN 'EN'
            ELSE UPPER("language")
          END AS "languageNorm",
          SUM("qtyIn")        AS total_in,
          SUM("qtyRemaining") AS total_remaining
        FROM "InventoryLot"
        GROUP BY 1,2,3,4
      ),
      sales_agg AS (
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
          END AS "conditionNorm",
          CASE
            WHEN "language" IS NULL OR "language" = ''  THEN 'EN'
            ELSE UPPER("language")
          END AS "languageNorm",
          COALESCE(SUM(qty),0) AS total_sold_applied
        FROM "SalesLog"
        WHERE "inventoryAppliedAt" IS NOT NULL
        GROUP BY 1,2,3,4
      ),
      balance AS (
        SELECT
          "cardmarketId",
          "isFoil",
          "condition" AS "conditionNorm",
          "language"  AS "languageNorm",
          "qtyOnHand"
        FROM "InventoryBalance"
      ),

      combined AS (
        SELECT
          COALESCE(l."cardmarketId", s."cardmarketId", b."cardmarketId") AS "cardmarketId",
          COALESCE(l."isFoil",      s."isFoil",      b."isFoil")         AS "isFoil",
          COALESCE(l."conditionNorm", s."conditionNorm", b."conditionNorm") AS "condition",
          COALESCE(l."languageNorm",  s."languageNorm",  b."languageNorm")  AS "language",
          COALESCE(l.total_in, 0)            AS total_in,
          COALESCE(l.total_remaining, 0)     AS total_remaining,
          COALESCE(s.total_sold_applied, 0)  AS total_sold_applied,
          COALESCE(b."qtyOnHand", 0)         AS balance_qty,
          COALESCE(l.total_in, 0) - COALESCE(s.total_sold_applied, 0)
            AS theoretical_on_hand,
          (COALESCE(l.total_in, 0) - COALESCE(s.total_sold_applied, 0))
            - COALESCE(b."qtyOnHand", 0)      AS diff_qty
        FROM lot_agg l
        FULL OUTER JOIN sales_agg s
          ON  s."cardmarketId"  = l."cardmarketId"
          AND s."isFoil"        = l."isFoil"
          AND s."conditionNorm" = l."conditionNorm"
          AND s."languageNorm"  = l."languageNorm"
        FULL OUTER JOIN balance b
          ON  b."cardmarketId"  = COALESCE(l."cardmarketId", s."cardmarketId")
          AND b."isFoil"        = COALESCE(l."isFoil",      s."isFoil")
          AND b."conditionNorm" = COALESCE(l."conditionNorm", s."conditionNorm")
          AND b."languageNorm"  = COALESCE(l."languageNorm",  s."languageNorm")
      )

      SELECT
        c."cardmarketId",
        COALESCE(bm."name", '(unknown)') AS "name",
        c."isFoil",
        c."condition",
        c."language",
        c.total_in,
        c.total_remaining,
        c.total_sold_applied,
        c.balance_qty,
        c.theoretical_on_hand,
        c.diff_qty
      FROM combined c
      LEFT JOIN "BlueprintMapping" bm
        ON bm."cardmarketId" = c."cardmarketId"
      WHERE
        c.theoretical_on_hand < 0
        OR c.balance_qty < 0
        OR c.theoretical_on_hand <> c.balance_qty
      ORDER BY c.diff_qty ASC
      LIMIT 500;
    `);

    // BigInt → Number normaliseren voor JSON
    const normalized = rows.map((r) => ({
      cardmarketId: Number(r.cardmarketId),
      name: r.name ?? "(unknown)",
      isFoil: !!r.isFoil,
      condition: String(r.condition),
      language: String(r.language),
      total_in: Number(r.total_in ?? 0),
      total_remaining: Number(r.total_remaining ?? 0),
      total_sold_applied: Number(r.total_sold_applied ?? 0),
      balance_qty: Number(r.balance_qty ?? 0),
      theoretical_on_hand: Number(r.theoretical_on_hand ?? 0),
      diff_qty: Number(r.diff_qty ?? 0),
    }));

    return NextResponse.json(
      { ok: true, count: normalized.length, rows: normalized },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("oversell diagnostics error", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
