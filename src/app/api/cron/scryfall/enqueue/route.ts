import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  // Pak ALLE cardmarketIds uit CMPriceGuide (dus niet alleen de missing ones)
  const ids = await prisma.cMPriceGuide.findMany({
    select: { cardmarketId: true },
  });

  if (ids.length === 0) {
    const remaining = await prisma.scryfallLookupQueue.count();
    return NextResponse.json({
      status: "idle",
      enqueued: 0,
      remainingQueue: remaining,
    });
  }

  // insert in batches
  let enq = 0;
  const CHUNK = 5000;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids
      .slice(i, i + CHUNK)
      .map((row) => ({ cardmarketId: row.cardmarketId }));

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
