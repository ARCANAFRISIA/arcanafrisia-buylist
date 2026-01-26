import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // ✅ Alleen cardmarketIds die in CMPriceGuide staan, maar nog NIET in ScryfallLookup
  // (en die nog niet definitief notFound zijn in de queue)
  const ids = await prisma.$queryRaw<Array<{ cardmarketId: number }>>`
    SELECT DISTINCT pg."cardmarketId"
    FROM "CMPriceGuide" pg
    LEFT JOIN "ScryfallLookup" sl
      ON sl."cardmarketId" = pg."cardmarketId"
    WHERE sl."cardmarketId" IS NULL
  `;

  if (ids.length === 0) {
    const remaining = await prisma.scryfallLookupQueue.count();
    return NextResponse.json({
      status: "idle",
      enqueued: 0,
      remainingQueue: remaining,
    });
  }

  let enq = 0;
  const CHUNK = 5000;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids
      .slice(i, i + CHUNK)
      .map((row) => ({ cardmarketId: Number(row.cardmarketId) }));

    const res = await prisma.scryfallLookupQueue.createMany({
      data: slice,
      skipDuplicates: true,
    });

    enq += res.count;
  }

  const remaining = await prisma.scryfallLookupQueue.count();
  return NextResponse.json({
    status: "queued",
    enqueued: enq,
    remainingQueue: remaining,
  });
}
