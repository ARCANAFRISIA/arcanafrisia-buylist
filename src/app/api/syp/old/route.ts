// src/app/api/syp/old/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  PREMODERN_SET_CODES,
  getEffectiveTix,
  getNeededQty,
  getPriceEur,
  getQtyOnHand,
  getTargetQty,
} from "@/lib/syp";

type RawRow = {
  cardmarketId: number | string;
  name: string;
  set: string;
  collectorNumber: string | null;
  imageSmall: string | null;
  priceEur: number | string | null;
  effective_tix: number | string | null;
  qtyOnHand: number | string | null;
};

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(
      1,
      Math.min(10000, Number(searchParams.get("limit") ?? "2000"))
    );

    const setCodes = PREMODERN_SET_CODES.map((x) => x.toLowerCase());
    const inList = setCodes.map((s) => `'${escapeSqlString(s)}'`).join(",");

    const rows = await prisma.$queryRawUnsafe<RawRow[]>(`
      WITH inv AS (
        SELECT
          "cardmarketId",
          COALESCE(SUM("qtyOnHand"), 0) AS "qtyOnHand"
        FROM "InventoryBalance"
        WHERE "isFoil" = false
          AND "language" = 'EN'
          AND "condition" IN ('EX', 'GD')
        GROUP BY "cardmarketId"
      )
      SELECT
        sl."cardmarketId" AS "cardmarketId",
        sl."name" AS "name",
        LOWER(sl."set") AS "set",
        sl."collectorNumber" AS "collectorNumber",
        sl."imageSmall" AS "imageSmall",
        COALESCE(sl."eur", 0) AS "priceEur",
        COALESCE(v."effective_tix", 0) AS "effective_tix",
        COALESCE(inv."qtyOnHand", 0) AS "qtyOnHand"
      FROM "ScryfallLookup" sl
      LEFT JOIN "V_ScryfallEffectiveTix" v
        ON v."cardmarketId" = sl."cardmarketId"
      LEFT JOIN inv
        ON inv."cardmarketId" = sl."cardmarketId"
      WHERE LOWER(sl."set") IN (${inList})
      ORDER BY sl."name" ASC
      LIMIT ${limit}
    `);

    const mapped = rows
      .map((row) => {
        const effectiveTix = getEffectiveTix(row.effective_tix);
        const priceEur = getPriceEur(row.priceEur);
        const qtyOnHand = getQtyOnHand(row.qtyOnHand);
        const targetQty = getTargetQty({
          tix: effectiveTix,
          price: priceEur,
          phase: "mature",
        });
        const neededQty = getNeededQty(targetQty, qtyOnHand);

        return {
          cardmarketId: Number(row.cardmarketId),
          name: row.name ?? "",
          set: String(row.set ?? "").toLowerCase(),
          collectorNumber: row.collectorNumber ?? "",
          imageSmall: row.imageSmall ?? "",
          phase: "mature" as const,
          effectiveTix,
          priceEur,
          qtyOnHand,
          targetQty,
          neededQty,
        };
      })
      .filter((x) => x.neededQty > 0)
      .sort((a, b) => {
        if (b.neededQty !== a.neededQty) return b.neededQty - a.neededQty;
        if (b.effectiveTix !== a.effectiveTix) return b.effectiveTix - a.effectiveTix;
        if (b.priceEur !== a.priceEur) return b.priceEur - a.priceEur;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({
      ok: true,
      count: mapped.length,
      setCount: PREMODERN_SET_CODES.length,
      rows: mapped,
    });
  } catch (error) {
    console.error("[api/syp/old] failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}