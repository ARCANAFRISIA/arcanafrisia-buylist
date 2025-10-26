import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  const queueCount = prisma.cMPriceGuideQueue.count();
  const guideCount = prisma.cMPriceGuide.count();
  const lastUpdate = prisma.cMPriceGuide.findFirst({
    select: { updatedAt: true },
    orderBy: { updatedAt: "desc" }
  });

  const [queue, guide, last] = await Promise.all([
    queueCount,
    guideCount,
    lastUpdate,
  ]);

  return NextResponse.json({
    queueRemaining: queue,
    priceguideRows: guide,
    lastUpdateAt: last?.updatedAt ?? null,
  });
}
