import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  cardmarketId: number;
  isFoil: boolean;
  condition: string;
  language?: string | null;
  delta: number; // +1 / -1 / +5 etc
  reason?: string | null;
};

function dayCode(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `ADJ-${yyyy}${mm}${dd}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;

    const cardmarketId = Number(body.cardmarketId);
    const isFoil = !!body.isFoil;
    const condition = String(body.condition || "").trim();
    const language = (body.language ?? "EN").toUpperCase();
    const delta = Number(body.delta);
    const reason = (body.reason ?? null)?.toString() ?? null;

    if (!cardmarketId || !condition || !Number.isFinite(delta) || delta === 0) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // balance ophalen of (alleen bij +delta) aanmaken
      let bal = await tx.inventoryBalance.findUnique({
        where: {
          cardmarketId_isFoil_condition_language: {
            cardmarketId,
            isFoil,
            condition,
            language,
          },
        },
        // id is BigInt, maar intern in tx ok
        select: { id: true, qtyOnHand: true, avgUnitCostEur: true },
      });

      if (!bal) {
        if (delta < 0) throw new Error("Cannot decrease: balance not found");

        bal = await tx.inventoryBalance.create({
          data: {
            cardmarketId,
            isFoil,
            condition,
            language,
            qtyOnHand: 0,
            avgUnitCostEur: null,
          },
          select: { id: true, qtyOnHand: true, avgUnitCostEur: true },
        });
      }

      // Bijboeken
      if (delta > 0) {
        const lotCost = bal.avgUnitCostEur ?? 0;

        await tx.inventoryLot.create({
          data: {
            cardmarketId,
            isFoil,
            condition,
            language,
            qtyIn: delta,
            qtyRemaining: delta,
            avgUnitCostEur: lotCost,
            sourceCode: dayCode(),
            sourceDate: new Date(),
            location: null,
          },
        });

        // ✅ GEEN id selecteren → geen BigInt in JSON response
        const b2 = await tx.inventoryBalance.update({
          where: { id: bal.id },
          data: { qtyOnHand: { increment: delta } },
          select: { qtyOnHand: true },
        });

        await tx.inventoryMutation.create({
          data: { cardmarketId, isFoil, condition, language, delta, reason },
        });

        return b2;
      }

      // Afboeken (delta < 0) FIFO over InventoryLot.qtyRemaining
      const need = Math.abs(delta);

      const sum = await tx.inventoryLot.aggregate({
        where: { cardmarketId, isFoil, condition, language, qtyRemaining: { gt: 0 } },
        _sum: { qtyRemaining: true },
      });

      const have = Number(sum._sum.qtyRemaining || 0);
      if (have < need) {
        throw new Error(`Not enough stock in lots (have ${have}, need ${need})`);
      }

      const lots = await tx.inventoryLot.findMany({
        where: { cardmarketId, isFoil, condition, language, qtyRemaining: { gt: 0 } },
        orderBy: [{ sourceDate: "asc" }, { createdAt: "asc" }],
        select: { id: true, qtyRemaining: true },
      });

      let remaining = need;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(Number(lot.qtyRemaining), remaining);
        await tx.inventoryLot.update({
          where: { id: lot.id },
          data: { qtyRemaining: { decrement: take } },
        });
        remaining -= take;
      }

      // ✅ GEEN id selecteren → geen BigInt in JSON response
      const b2 = await tx.inventoryBalance.update({
        where: { id: bal.id },
        data: { qtyOnHand: { decrement: need } },
        select: { qtyOnHand: true },
      });

      await tx.inventoryMutation.create({
        data: { cardmarketId, isFoil, condition, language, delta, reason },
      });

      return b2;
    });

    return NextResponse.json({ ok: true, updated });
  } catch (e: any) {
    console.error("inventory mutate error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "inventory mutate failed" },
      { status: 500 }
    );
  }
}
