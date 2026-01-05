export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  // Distinct sets + count (Postgres groupBy)
  const rows = await prisma.scryfallLookup.groupBy({
    by: ["set"],
    _count: { set: true },
    orderBy: { set: "asc" },
  });

  return NextResponse.json({
    ok: true,
    sets: rows.map(r => ({
      set: r.set,
      count: r._count.set,
    })),
  });
}
