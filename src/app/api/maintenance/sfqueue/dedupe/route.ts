import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
export const dynamic = "force-dynamic";

export async function POST() {
  // verwijder dubbele cardmarketId's, behoud laagste id
  const q = `
    DELETE FROM "ScryfallLookupQueue" q1
    USING "ScryfallLookupQueue" q2
    WHERE q1."cardmarketId" = q2."cardmarketId"
      AND q1.id > q2.id
  `;
  const rows = await prisma.$executeRawUnsafe(q);
  const left = await prisma.scryfallLookupQueue.count();
  return NextResponse.json({ ok: true, removed: Number(rows), remaining: left });
}
export async function GET(){ return POST(); }
