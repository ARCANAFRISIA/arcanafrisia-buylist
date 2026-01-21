import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Item = { lotId: string; qty: number };

function makeBatchId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `1DR-${y}${m}${day}-${hh}${mm}`;
}

export async function POST(req: NextRequest) {
  try {
    // auth
    if (process.env.NODE_ENV === "production") {
      const token = req.headers.get("x-admin-token");
      if (!token || token !== process.env.ADMIN_TOKEN) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const simulate = body?.simulate === true || body?.simulate === 1 || body?.simulate === "1";
    const batchId = String(body?.batchId ?? "").trim() || makeBatchId();
    const items = (body?.items ?? []) as Item[];

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: "missing items[]" }, { status: 400 });
    }

    const cleaned: Item[] = [];
    const errors: Array<{ idx: number; message: string }> = [];

    items.forEach((it, idx) => {
      const lotId = String((it as any)?.lotId ?? "").trim();
      const qty = Number((it as any)?.qty);
      if (!lotId) return errors.push({ idx, message: "missing lotId" });
      if (!Number.isInteger(qty) || qty <= 0) return errors.push({ idx, message: `invalid qty: ${String((it as any)?.qty)}` });
      cleaned.push({ lotId, qty });
    });

    if (errors.length) {
      return NextResponse.json({ ok: false, error: "validation failed", errors }, { status: 400 });
    }

    const lotIds = Array.from(new Set(cleaned.map(x => x.lotId)));

    const lots = await prisma.inventoryLot.findMany({
      where: { id: { in: lotIds } },
      select: {
        id: true,
        cardmarketId: true,
        isFoil: true,
        condition: true,
        language: true,
        qtyRemaining: true,
        location: true,
      },
    });

    const byId = new Map(lots.map(l => [l.id, l]));

    // quick checks
    const checkErrors: any[] = [];
    for (const it of cleaned) {
      const lot = byId.get(it.lotId);
      if (!lot) { checkErrors.push({ lotId: it.lotId, message: "lot not found" }); continue; }
      const have = Number(lot.qtyRemaining ?? 0);
      if (it.qty > have) checkErrors.push({ lotId: it.lotId, message: "qty exceeds lot.qtyRemaining", have, want: it.qty });
    }
    if (checkErrors.length) {
      return NextResponse.json({ ok: false, error: "precheck failed", checkErrors }, { status: 400 });
    }

    if (simulate) {
      return NextResponse.json({
        ok: true,
        simulate: true,
        batchId,
        lots: cleaned.length,
        totalQty: cleaned.reduce((a, x) => a + x.qty, 0),
      });
    }

    let updatedLots = 0;
    let updatedBalances = 0;
    let txnsCreated = 0;

    // apply per item
    for (const it of cleaned) {
      const lot = byId.get(it.lotId)!;

      await prisma.$transaction(async (tx) => {
        // 1) lot decrement
        await tx.inventoryLot.update({
          where: { id: it.lotId },
          data: { qtyRemaining: { decrement: it.qty } },
        });
        updatedLots++;

        // 2) balance decrement (manual, because id is bigint)
        const bal = await tx.inventoryBalance.findFirst({
          where: {
            cardmarketId: lot.cardmarketId,
            isFoil: lot.isFoil,
            condition: lot.condition,
            language: lot.language,
          },
          select: { id: true },
        });

        if (bal) {
          await tx.inventoryBalance.update({
            where: { id: bal.id },
            data: { qtyOnHand: { decrement: it.qty } },
          });
        } else {
          await tx.inventoryBalance.create({
            data: {
              cardmarketId: lot.cardmarketId,
              isFoil: lot.isFoil,
              condition: lot.condition,
              language: lot.language,
              qtyOnHand: -it.qty,
              avgUnitCostEur: null,
              lastSaleAt: null,
            },
          });
        }
        updatedBalances++;

        // 3) txn log (gebruik een bestaande kind in jouw schema; ik gebruik ADJUSTMENT)
        await tx.inventoryTxn.create({
          data: {
            kind: "CT1DAYREADY_OUT",
            ts: new Date(),
            cardmarketId: lot.cardmarketId,
            isFoil: lot.isFoil,
            condition: lot.condition,
            language: lot.language,
            qty: -it.qty,
            unitCostEur: null,
            refSource: "CT1DAYREADY",
            refExternalId: batchId,
          },
        });
        txnsCreated++;
      });
    }

    return NextResponse.json({
      ok: true,
      simulate: false,
      batchId,
      items: cleaned.length,
      totalQty: cleaned.reduce((a, x) => a + x.qty, 0),
      updatedLots,
      updatedBalances,
      txnsCreated,
    });
  } catch (e: any) {
    console.error("ct1day apply error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
