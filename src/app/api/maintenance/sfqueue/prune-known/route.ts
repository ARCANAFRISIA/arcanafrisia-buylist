import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
export const dynamic = "force-dynamic";

export async function POST() {
  const delKnown = await prisma.$executeRawUnsafe(`
    DELETE FROM "ScryfallLookupQueue" q
    USING "ScryfallLookup" sl
    WHERE q."cardmarketId" = sl."cardmarketId"
  `);
  const del404 = await prisma.scryfallLookupQueue.deleteMany({
    where: { notFound: true }
  });
  const left = await prisma.scryfallLookupQueue.count();
  return NextResponse.json({
    ok: true,
    removedKnown: Number(delKnown),
    removedNotFound: del404.count,
    remaining: left
  });
}
export async function GET(){ return POST(); }
