import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const total = await prisma.blueprintMapping.count();
  const mapped = await prisma.blueprintMapping.count({
    where: { cardmarketId: { not: null } }
  });

  return NextResponse.json({
    total,
    mapped,
    coveragePct: total ? Math.round((mapped * 100) / total) : 0
  });
}
