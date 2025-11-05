import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
export const dynamic = "force-dynamic";

export async function GET() {
  const total = await prisma.blueprintMapping.count();
  const cmMapped = await prisma.blueprintMapping.count({ where: { cardmarketId: { not: null } } });
  const noSf = await prisma.blueprintMapping.count({ where: { scryfallId: null } });
  const sfButNoCM = await prisma.blueprintMapping.count({
    where: { scryfallId: { not: null }, cardmarketId: null }
  });
  const noSetOrNum = await prisma.blueprintMapping.count({
    where: { OR: [{ setCode: null }, { collectorNumber: null }] }
  });

  // Pak een paar voorbeelden om te inspecteren
  const sampleNoSf = await prisma.blueprintMapping.findMany({
    where: { scryfallId: null },
    take: 20,
    orderBy: { blueprintId: "asc" },
    select: { blueprintId: true, expansionId: true, name: true, collectorNumber: true, setCode: true }
  });

  return NextResponse.json({
    total, cmMapped,
    buckets: {
      noScryfallId: noSf,
      scryfallButNoCardmarketId: sfButNoCM,
      missingSetOrCollectorNumber: noSetOrNum
    },
    sampleNoScryfallId: sampleNoSf
  });
}
