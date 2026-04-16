import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // Alleen CM ids die:
  // 1) wel in CMPriceGuide staan
  // 2) nog niet in ScryfallLookup staan
  // 3) nog niet ooit in ScryfallLookupQueue staan
  //
  // Belangrijk:
  // - succesvolle lookups zitten in ScryfallLookup
  // - 404 / retries / wachtende jobs blijven in ScryfallLookupQueue
  // - daardoor enqueue'en we alleen echt "nieuwe" ids
  const ids = await prisma.$queryRaw<Array<{ cardmarketId: number }>>`
    SELECT DISTINCT pg."cardmarketId"
    FROM "CMPriceGuide" pg
    LEFT JOIN "ScryfallLookup" sl
      ON sl."cardmarketId" = pg."cardmarketId"
    LEFT JOIN "ScryfallLookupQueue" q
      ON q."cardmarketId" = pg."cardmarketId"
    WHERE sl."cardmarketId" IS NULL
      AND q."cardmarketId" IS NULL
  `;

  if (ids.length === 0) {
    const queueActive = await prisma.scryfallLookupQueue.count({
      where: {
        notFound: false,
        attempts: { lte: 3 },
      },
    });

    const queueNotFound = await prisma.scryfallLookupQueue.count({
      where: { notFound: true },
    });

    const totalLookup = await prisma.scryfallLookup.count();

    return NextResponse.json({
      status: "idle",
      enqueued: 0,
      queueActive,
      queueNotFound,
      totalLookup,
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

  const queueActive = await prisma.scryfallLookupQueue.count({
    where: {
      notFound: false,
      attempts: { lte: 3 },
    },
  });

  const queueNotFound = await prisma.scryfallLookupQueue.count({
    where: { notFound: true },
  });

  const totalLookup = await prisma.scryfallLookup.count();

  return NextResponse.json({
    status: "queued",
    enqueued: enq,
    queueActive,
    queueNotFound,
    totalLookup,
  });
}