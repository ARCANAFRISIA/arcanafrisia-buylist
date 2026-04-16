// src/app/api/syp/new/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  ACTIVE_SETS,
  getEffectiveTix,
  getNeededQty,
  getPriceEur,
  getQtyOnHand,
  getTargetQty,
  type SypPhase,
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

type VariantRole = "primary" | "secondary";

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Pakt een bruikbaar numeriek deel uit collectorNumber.
 * Voorbeelden:
 * "123" -> 123
 * "123a" -> 123
 * "045" -> 45
 * "A-12" -> 12
 * null/geen match -> heel hoog getal, zodat die nooit primary wint
 */
function getCollectorNumberSortValue(input: string | null | undefined): number {
  const s = String(input ?? "").trim();
  const match = s.match(/\d+/);
  if (!match) return Number.MAX_SAFE_INTEGER;

  const n = Number(match[0]);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function getSecondaryTargetQty(args: {
  tix: number;
  phase: SypPhase;
}): number {
  const tix = Number(args.tix ?? 0);
  const phase = args.phase;

  // Alleen voor new-bucket relevant.
  // Secondary printings bewust strak houden.
  if (phase === "release" || phase === "stabilized") {
    if (tix > 3) return 4;
    if (tix > 1) return 2;
    return 0;
  }

  return 0;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(
      1,
      Math.min(5000, Number(searchParams.get("limit") ?? "500"))
    );

    const phaseBySet = new Map<string, SypPhase>(
      ACTIVE_SETS.map((x) => [x.set.toLowerCase(), x.phase])
    );

    const setCodes = ACTIVE_SETS.map((x) => x.set.toLowerCase());
    const inList = setCodes.map((s) => `'${escapeSqlString(s)}'`).join(",");

    const rows = await prisma.$queryRawUnsafe<RawRow[]>(`
      WITH inv AS (
        SELECT
          "cardmarketId",
          COALESCE(SUM("qtyOnHand"), 0) AS "qtyOnHand"
        FROM "InventoryBalance"
        WHERE "isFoil" = false
          AND "language" = 'EN'
          AND "condition" IN ('NM', 'EX')
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

    // Eerst basis mappen
    const baseRows = rows
      .map((row) => {
        const setCode = String(row.set ?? "").toLowerCase();
        const phase = phaseBySet.get(setCode);
        if (!phase) return null;

        return {
          cardmarketId: Number(row.cardmarketId),
          name: row.name ?? "",
          set: setCode,
          collectorNumber: row.collectorNumber ?? "",
          collectorNumberSortValue: getCollectorNumberSortValue(row.collectorNumber),
          imageSmall: row.imageSmall ?? "",
          phase,
          effectiveTix: getEffectiveTix(row.effective_tix),
          priceEur: getPriceEur(row.priceEur),
          qtyOnHand: getQtyOnHand(row.qtyOnHand),
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    // Bepaal per (set + name) wat de primary printing is
    const primaryMap = new Map<string, number>();

    for (const row of baseRows) {
      const groupKey = `${row.set}__${row.name}`.toLowerCase();
      const currentBest = primaryMap.get(groupKey);

      if (currentBest === undefined || row.collectorNumberSortValue < currentBest) {
        primaryMap.set(groupKey, row.collectorNumberSortValue);
      }
    }

    const mapped = baseRows
      .map((row) => {
        const groupKey = `${row.set}__${row.name}`.toLowerCase();
        const bestCollectorValue =
          primaryMap.get(groupKey) ?? Number.MAX_SAFE_INTEGER;

        const variantRole: VariantRole =
          row.collectorNumberSortValue === bestCollectorValue
            ? "primary"
            : "secondary";

        const baseTargetQty = getTargetQty({
          tix: row.effectiveTix,
          price: row.priceEur,
          phase: row.phase,
        });

        const targetQty =
          variantRole === "primary"
            ? baseTargetQty
            : getSecondaryTargetQty({
                tix: row.effectiveTix,
                phase: row.phase,
              });

        const neededQty = getNeededQty(targetQty, row.qtyOnHand);

        return {
          cardmarketId: row.cardmarketId,
          name: row.name,
          set: row.set,
          collectorNumber: row.collectorNumber,
          imageSmall: row.imageSmall,
          phase: row.phase,
          variantRole,
          effectiveTix: row.effectiveTix,
          priceEur: row.priceEur,
          qtyOnHand: row.qtyOnHand,
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
      activeSets: ACTIVE_SETS,
      rows: mapped,
    });
  } catch (error) {
    console.error("[api/syp/new] failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}