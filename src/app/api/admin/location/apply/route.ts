// src/app/api/admin/location/apply/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Move = { lotId: string; newLocation: string };

// MAIN: A01.01  (A-J, row 01-06, seg 01-99)
function isValidMainLocation(loc: string) {
  const m = loc.trim().toUpperCase().match(/^([A-J])(\d{2})\.(\d{2})$/);
  if (!m) return false;
  const row = Number(m[2]);
  const seg = Number(m[3]);
  return row >= 1 && row <= 6 && seg >= 1 && seg <= 99;
}

// CTBULK: CB-A01.01 (CB- + A-H, row 01-04, seg 01-99)
function isValidCtbLocation(loc: string) {
  const m = loc.trim().toUpperCase().match(/^CB-([A-H])(\d{2})\.(\d{2})$/);
  if (!m) return false;
  const row = Number(m[2]);
  const seg = Number(m[3]);
  return row >= 1 && row <= 4 && seg >= 1 && seg <= 99;
}

function isValidLocation(loc: string) {
  const s = loc.trim().toUpperCase();
  if (/^([A-J])(\d{2})$/.test(s)) {
    const row = Number(s.slice(1, 3));
    return row >= 1 && row <= 6;
  }
  const m = s.match(/^CB-([A-H])(\d{2})$/);
  if (m) {
    const row = Number(m[2]);
    return row >= 1 && row <= 4;
  }
  return false;
}


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

    const CHUNK = 500;
    let updatedCount = 0;

    for (let i = 0; i < cleaned.length; i += CHUNK) {
      const chunk = cleaned.slice(i, i + CHUNK);

      await prisma.$transaction(
        chunk.map((m) =>
          prisma.inventoryLot.update({
            where: { id: m.lotId },
            data: { location: m.newLocation },
          })
        )
      );

      updatedCount += chunk.length;
    }

    return NextResponse.json({ ok: true, updatedCount });
  } catch (e: any) {
    console.error("location apply error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
