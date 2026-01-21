import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PlanRow = {
  lotId: string;
  newLocation: string;
  qty: number;
};

function isValidMainLocation(loc: string) {
  const m = loc.trim().toUpperCase().match(/^([A-J])(\d{2})\.(\d{2})$/);
  if (!m) return false;
  const row = Number(m[2]);
  const seg = Number(m[3]);
  return row >= 1 && row <= 6 && seg >= 1 && seg <= 99;
}

function isValidCtbLocation(loc: string) {
  const m = loc.trim().toUpperCase().match(/^CB-([A-H])(\d{2})\.(\d{2})$/);
  if (!m) return false;
  const row = Number(m[2]);
  const seg = Number(m[3]);
  return row >= 1 && row <= 4 && seg >= 1 && seg <= 99;
}

function isValidLocation(loc: string) {
  return isValidMainLocation(loc) || isValidCtbLocation(loc);
}


export async function POST(req: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production") {
      const token = req.headers.get("x-admin-token");
      if (!token || token !== process.env.ADMIN_TOKEN) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const plan = (body?.plan ?? []) as PlanRow[];
    const simulate = body?.simulate === true || body?.simulate === 1 || body?.simulate === "1";

    if (!Array.isArray(plan) || plan.length === 0) {
      return NextResponse.json({ ok: false, error: "missing plan[]" }, { status: 400 });
    }

    const errors: Array<{ idx: number; message: string }> = [];
    const cleaned: PlanRow[] = [];

    plan.forEach((r, idx) => {
      const lotId = String((r as any)?.lotId ?? "").trim();
      const newLocation = String((r as any)?.newLocation ?? "").trim();
      const qty = Number((r as any)?.qty);

      if (!lotId) return errors.push({ idx, message: "missing lotId" });
      if (!newLocation || !isValidLocation(newLocation)) return errors.push({ idx, message: `invalid newLocation: ${newLocation}` });
      if (!Number.isInteger(qty) || qty <= 0) return errors.push({ idx, message: `invalid qty: ${String((r as any)?.qty)}` });

      cleaned.push({ lotId, newLocation, qty });
    });

    if (errors.length) {
      return NextResponse.json({ ok: false, error: "validation failed", errors }, { status: 400 });
    }

    // group by lotId
    const byLot = new Map<string, PlanRow[]>();
    for (const r of cleaned) {
      const arr = byLot.get(r.lotId) ?? [];
      arr.push(r);
      byLot.set(r.lotId, arr);
    }

    const lotIds = Array.from(byLot.keys());

    const lots = await prisma.inventoryLot.findMany({
      where: { id: { in: lotIds } },
      select: {
        id: true,
        cardmarketId: true,
        isFoil: true,
        condition: true,
        language: true,
        qtyIn: true,
        qtyRemaining: true,
        avgUnitCostEur: true,
        sourceCode: true,
        sourceDate: true,
        location: true,
      },
    });

    const lotById = new Map(lots.map(l => [l.id, l]));

    // qty sum match check
    const qtyErrors: Array<{ lotId: string; message: string; have?: number; want?: number }> = [];
    for (const [lotId, rows] of byLot) {
      const lot = lotById.get(lotId);
      if (!lot) { qtyErrors.push({ lotId, message: "lot not found" }); continue; }
      const want = rows.reduce((a, x) => a + x.qty, 0);
      const have = Number(lot.qtyRemaining ?? 0);
      if (want !== have) qtyErrors.push({ lotId, message: "qty mismatch (plan sum != lot.qtyRemaining)", have, want });
    }
    if (qtyErrors.length) {
      return NextResponse.json({ ok: false, error: "qty validation failed", qtyErrors }, { status: 400 });
    }

    if (simulate) {
      return NextResponse.json({
        ok: true,
        simulate: true,
        lotsInPlan: byLot.size,
        rowsInPlan: cleaned.length,
        wouldUpdateLots: byLot.size,
        wouldCreateLots: cleaned.length - byLot.size,
      });
    }

    let updatedLots = 0;
    let createdLots = 0;

    for (const [lotId, rows] of byLot) {
      const lot = lotById.get(lotId)!;

      await prisma.$transaction(async (tx) => {
        const first = rows[0];

        // update original lot to first chunk
        await tx.inventoryLot.update({
          where: { id: lotId },
          data: {
            location: first.newLocation,
            qtyIn: first.qty,
            qtyRemaining: first.qty,
          },
        });

        // create extra lots if split across multiple rows
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          await tx.inventoryLot.create({
            data: {
              cardmarketId: lot.cardmarketId,
              isFoil: lot.isFoil,
              condition: lot.condition,
              language: lot.language,
              qtyIn: r.qty,
              qtyRemaining: r.qty,
              avgUnitCostEur: lot.avgUnitCostEur,
              sourceCode: lot.sourceCode,
              sourceDate: lot.sourceDate,
              location: r.newLocation,
            },
          });
          createdLots++;
        }
      });

      updatedLots++;
    }

    return NextResponse.json({
      ok: true,
      lotsInPlan: byLot.size,
      rowsInPlan: cleaned.length,
      updatedLots,
      createdLots,
    });
  } catch (e: any) {
    console.error("apply-plan error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
