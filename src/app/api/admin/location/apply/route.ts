import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isValidLocation(loc: string) {
  // A-J, 01-99, batch 01-99 (jouw formaat)
  return /^([A-J])(\d{2})\.(\d{2})$/.test(loc.trim());
}

type Move = { lotId: string; newLocation: string };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const moves = (body?.moves ?? []) as Move[];

    if (!Array.isArray(moves) || moves.length === 0) {
      return NextResponse.json({ ok: false, error: "missing moves[]" }, { status: 400 });
    }

    const errors: { idx: number; message: string }[] = [];
    const cleaned: Move[] = [];

    moves.forEach((m, idx) => {
      const lotId = String(m?.lotId ?? "").trim();
      const newLocation = String(m?.newLocation ?? "").trim();

      if (!lotId) {
        errors.push({ idx, message: "missing lotId" });
        return;
      }
      if (!newLocation || !isValidLocation(newLocation)) {
        errors.push({ idx, message: `invalid newLocation: ${newLocation}` });
        return;
      }
      cleaned.push({ lotId, newLocation });
    });

    if (errors.length) {
      return NextResponse.json({ ok: false, error: "validation failed", errors }, { status: 400 });
    }

    // apply in transaction
    const updated = await prisma.$transaction(
      cleaned.map((m) =>
        prisma.inventoryLot.update({
          where: { id: m.lotId },
          data: { location: m.newLocation },
          select: { id: true, location: true },
        })
      )
    );

    return NextResponse.json({ ok: true, updatedCount: updated.length, updated });
  } catch (e: any) {
    console.error("location apply error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
