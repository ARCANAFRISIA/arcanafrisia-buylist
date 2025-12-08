// src/app/api/prices/sets/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const EXCLUDED_SET_CODES = ["lea", "leb", "ced", "cei", "sum", "4bb"];

export async function GET() {
  // haal unieke set-codes op uit scryfallLookup
  const grouped = await prisma.scryfallLookup.groupBy({
    by: ["set"],
    _count: { _all: true },
    where: {
      set: { notIn: EXCLUDED_SET_CODES },
    },
  });

  // we hebben (nog) geen aparte tabel met namen,
  // dus gebruiken voorlopig gewoon de code als naam.
  const sets = grouped
    .map((g) => ({
      code: g.set,
      name: g.set.toUpperCase(),
      count: g._count._all,
    }))
    .sort((a, b) => a.code.localeCompare(b.code)); // simpel alfabetisch

  return NextResponse.json({ sets });
}
