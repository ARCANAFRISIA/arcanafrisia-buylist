import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  const [queue, have, last] = await Promise.all([
    prisma.scryfallLookupQueue.count(),
    prisma.scryfallLookup.count(),
    prisma.scryfallLookup.findFirst({ select: { updatedAt: true }, orderBy: { updatedAt: "desc" } })
  ]);
  return NextResponse.json({ queue, have, lastUpdatedAt: last?.updatedAt ?? null });
}
