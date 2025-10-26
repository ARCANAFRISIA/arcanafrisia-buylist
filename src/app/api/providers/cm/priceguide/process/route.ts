import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const maxDuration = 300; // Vercel: langere runtime

// parse helper
function parseRow(line: string) {
  const delim = line.includes(";") ? ";" : ",";
  const cols = line.split(delim);

  const id = Number((cols[0] ?? "").trim().replace(/^"|"$/g, ""));
  if (!Number.isFinite(id) || id <= 0) return null;

  const num = (i: number) => {
    const v = (cols[i] ?? "").trim().replace(/^"|"$/g, "");
    if (!v) return null;
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  return {
    cardmarketId: id,
    trend:        num(3),
    germanProLow: num(4),
    suggested:    num(5),
    foilTrend:    num(8),
    lowEx:        num(9),
    avg1:         num(10),
    avg7:         num(11),
    avg30:        num(12),
    foilAvg1:     num(13),
    foilAvg7:     num(14),
    foilAvg30:    num(15),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const batchSize = Number(url.searchParams.get("batch")) || 2000;    // rows per loop
  const subBatch  = Number(url.searchParams.get("tx")) || 250;        // upserts per transaction

  // Pak de oudste queue items
  const queue = await prisma.cMPriceGuideQueue.findMany({
    orderBy: { id: "asc" },
    take: batchSize,
  });

  if (queue.length === 0) {
    const remaining = await prisma.cMPriceGuideQueue.count();
    return NextResponse.json({ status: "idle", processed: 0, remaining });
  }

  let processed = 0;
  const toDelete: number[] = [];

  // in subbatches verwerken om transacties klein te houden
  for (let i = 0; i < queue.length; i += subBatch) {
    const slice = queue.slice(i, i + subBatch);

    const ops = [];
    for (const row of slice) {
      const parsed = parseRow(row.line);
      if (!parsed) { toDelete.push(row.id); continue; } // skip on parse fail

      ops.push(
        prisma.cMPriceGuide.upsert({
          where: { cardmarketId: parsed.cardmarketId },
          create: parsed,
          update: parsed,
        })
      );
    }

    // voer de upserts in 1 tx uit
    await prisma.$transaction(ops);
    processed += slice.length;

    // markeer deze slice als done
    toDelete.push(...slice.map((r) => r.id));
  }

  // verwijder verwerkte queue records in één klap
  await prisma.cMPriceGuideQueue.deleteMany({
    where: { id: { in: toDelete } },
  });

  const remaining = await prisma.cMPriceGuideQueue.count();
  return NextResponse.json({ status: "processing", processed, remaining, batchSize, subBatch });
}
