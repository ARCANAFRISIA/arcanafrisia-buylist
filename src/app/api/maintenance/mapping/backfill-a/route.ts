// src/app/api/maintenance/mapping/backfill-a/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function runBackfill() {
  // A) Scryfall → setCode, collectorNumber  (let op: "set" is gereserveerd, dus "sl"."set")
  const q1 = `
    UPDATE "BlueprintMapping" bm
    SET
      "setCode"         = sl."set",
      "collectorNumber" = sl."collectorNumber",
      "updatedAt"       = now()
    FROM "ScryfallLookup" sl
    WHERE bm."scryfallId" = sl."scryfallId"
      AND (
        bm."setCode" IS NULL
        OR bm."collectorNumber" IS NULL
      )
  `;

  // B) Scryfall → cardmarketId
  const q2 = `
    UPDATE "BlueprintMapping" bm
    SET
      "cardmarketId" = sl."cardmarketId",
      "updatedAt"    = now()
    FROM "ScryfallLookup" sl
    WHERE bm."cardmarketId" IS NULL
      AND bm."scryfallId" = sl."scryfallId"
      AND sl."cardmarketId" IS NOT NULL
  `;

  const res1 = await prisma.$executeRawUnsafe(q1);
  const res2 = await prisma.$executeRawUnsafe(q2);

  return NextResponse.json({
    status: "ok",
    updatedFromSF: Number(res1),
    setCardmarketId: Number(res2),
  });
}

export async function POST() {
  return runBackfill();
}

// Handig voor testen in de browser; haal zonodig weg in prod
export async function GET() {
  return runBackfill();
}
