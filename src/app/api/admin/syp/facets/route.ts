import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [setRows, condRows] = await Promise.all([
      prisma.sypDemand.findMany({
        distinct: ["setName"],
        select: { setName: true },
        where: { setName: { not: null } },
        orderBy: { setName: "asc" },
      }),
      prisma.sypDemand.findMany({
        distinct: ["condition"],
        select: { condition: true },
        where: { condition: { not: null } },
        orderBy: { condition: "asc" },
      }),
    ]);

    const sets = setRows.map((r) => r.setName!).filter(Boolean);
    const conditions = condRows.map((r) => r.condition!).filter(Boolean);

    return NextResponse.json({ ok: true, sets, conditions });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
