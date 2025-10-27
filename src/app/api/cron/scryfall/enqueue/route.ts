import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  // Pak alle cardmarketId's die in CMPriceGuide staan maar nog NIET in ScryfallLookup
  // En zet ze in de queue om opgehaald te worden.
  const ids = await prisma.cMPriceGuide.findMany({
    select: { cardmarketId: true },
  });

  const existing = await prisma.scryfallLookup.findMany({
    select: { cardmarketId: true },
    where: { cardmarketId: { in: ids.map(i => i.cardmarketId) } },
  });

  const existingSet = new Set(existing.map(e => e.cardmarketId));
  const missing = ids.map(i => i.cardmarketId).filter(id => !existingSet.has(id));

  if (missing.length === 0) {
    const remaining = await prisma.scryfallLookupQueue.count();
    return NextResponse.json({ status: "idle", enqueued: 0, remainingQueue: remaining });
  }

  // insert in chunks
  let enq = 0;
  const CHUNK = 5000;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const slice = missing.slice(i, i + CHUNK).map(id => ({ cardmarketId: id }));
    const res = await prisma.scryfallLookupQueue.createMany({ data: slice, skipDuplicates: true });
    enq += res.count;
  }

  const remaining = await prisma.scryfallLookupQueue.count();
  return NextResponse.json({ status: "queued", enqueued: enq, remainingQueue: remaining });
}
