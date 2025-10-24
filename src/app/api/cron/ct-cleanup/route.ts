import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  // alles ouder dan 30 dagen opruimen, maar per maand per key de laatste snapshot bewaren
  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);

  const deleted = await prisma.$executeRawUnsafe(`
    WITH old AS (
      SELECT "blueprintId","bucket","isFoil","capturedAt"
      FROM "CTMarketSummary"
      WHERE "capturedAt" < $1
    ),
    keep AS (
      SELECT
        "blueprintId","bucket","isFoil",
        date_trunc('month', "capturedAt") AS m,
        max("capturedAt") AS maxcap
      FROM old
      GROUP BY 1,2,3,4
    )
    DELETE FROM "CTMarketSummary" s
    USING old o
    LEFT JOIN keep k
      ON k."blueprintId" = o."blueprintId"
     AND k."bucket"      = o."bucket"
     AND k."isFoil"      = o."isFoil"
     AND k.m             = date_trunc('month', o."capturedAt")
     AND k.maxcap        = o."capturedAt"
    WHERE s."blueprintId" = o."blueprintId"
      AND s."bucket"      = o."bucket"
      AND s."isFoil"      = o."isFoil"
      AND s."capturedAt"  = o."capturedAt"
      AND s."capturedAt"  < $1
      AND k.maxcap IS NULL;
  `, cutoff);

  return NextResponse.json({ status: "ok", cutoff: cutoff.toISOString(), deleted });
}
