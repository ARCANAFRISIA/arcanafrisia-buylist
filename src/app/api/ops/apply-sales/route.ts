// src/app/api/ops/apply-sales/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SaleLike = {
  id: string;
  source: string | null;
  externalId: string | null;
  createdAt: Date;
  // Verwachte SKU velden in jouw SalesLog:
  cardmarketId: number | null;
  isFoil: boolean | null;
  condition: string | null;
  quantity: number | null;
};

export async function POST(req: NextRequest) {
  try {
    // ---- Auth (optioneel, maar aanbevolen) ----
    const token = req.headers.get("x-admin-token");
    if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const sinceParam = url.searchParams.get("since");
    const simulate = url.searchParams.get("simulate") === "1";
    const limit = Number(url.searchParams.get("limit") || "0");
    const take = limit && limit > 0 ? limit : 500;

    // ---- since vaststellen: query > cursor > anders: stop ----
    let since: Date | null = null;
    if (sinceParam) {
      const d = new Date(sinceParam);
      if (!isNaN(d.getTime())) since = d;
    }
    if (!since) {
      const cursor = await prisma.syncCursor.findUnique({
        where: { key: "sales.apply.since" },
      });
      if (cursor?.value) {
        const d = new Date(cursor.value);
        if (!isNaN(d.getTime())) since = d;
      }
    }
    if (!since) {
      return NextResponse.json(
        { ok: false, error: "missing since (provide ?since=... or set SyncCursor sales.apply.since)" },
        { status: 400 },
      );
    }

    // ---- candidate sales ophalen (idempotent via inventoryAppliedAt) ----
    const sales = (await prisma.salesLog.findMany({
      where: { inventoryAppliedAt: null, createdAt: { gte: since } },
      take,
      orderBy: { createdAt: "asc" },
    })) as unknown as SaleLike[];

    // Dry-run rapportage
    const wouldConsume: Array<{
      salesLogId: string;
      cardmarketId: number;
      isFoil: boolean;
      condition: string;
      qty: number;
    }> = [];

    const errors: Array<{ salesLogId: string; message: string }> = [];
    let processed = 0;

    // ---- helpers ----
    const toBool = (b: any) => (b === true || b === 1 || b === "true");

    // FIFO apply van één sale in 1 transaction
    async function applyOneSale(s: SaleLike) {
      const cardmarketId = Number(s.cardmarketId);
      const isFoil = toBool(s.isFoil);
      const condition = String(s.condition || "").toUpperCase();
      const qty = Number(s.quantity || 0);

      if (!Number.isFinite(cardmarketId) || !condition || !Number.isFinite(qty) || qty <= 0) {
        throw new Error("invalid sale fields (cardmarketId/condition/quantity)");
      }

      await prisma.$transaction(async (tx) => {
        // 1) FIFO uit lots
        let remaining = qty;

        const lots = await tx.inventoryLot.findMany({
          where: { cardmarketId, isFoil, condition, qtyRemaining: { gt: 0 } },
          orderBy: [{ sourceDate: "asc" }, { createdAt: "asc" }],
        });

        for (const lot of lots) {
          if (remaining <= 0) break;
          const consume = Math.min(lot.qtyRemaining, remaining);
          if (consume > 0) {
            await tx.inventoryLot.update({
              where: { id: lot.id },
              data: { qtyRemaining: { decrement: consume } },
            });
            await tx.inventoryTxn.create({
              data: {
                kind: "SALE_OUT",
                ts: new Date(),
                cardmarketId,
                isFoil,
                condition,
                qty: -consume,
                unitCostEur: null,
                refSource: s.source ?? null,
                refExternalId: s.externalId ?? null,
              },
            });
            remaining -= consume;
          }
        }

        // 2) Balance afboeken (kan negatief; laat zichtbaar worden)
        await tx.inventoryBalance.upsert({
          where: {
            cardmarketId_isFoil_condition: { cardmarketId, isFoil, condition },
          },
          create: {
            cardmarketId,
            isFoil,
            condition,
            qtyOnHand: -qty,
            avgUnitCostEur: null,
            lastSaleAt: s.createdAt,
          },
          update: {
            qtyOnHand: { decrement: qty },
            lastSaleAt: s.createdAt,
          },
        });

        // 3) Markeren als toegepast
        await tx.salesLog.update({
          where: { id: s.id },
          data: { inventoryAppliedAt: new Date() },
        });
      });
    }

    // ---- hoofdloop ----
    for (const s of sales) {
      try {
        const cardmarketId = Number(s.cardmarketId);
        const isFoil = toBool(s.isFoil);
        const condition = String(s.condition || "").toUpperCase();
        const qty = Number(s.quantity || 0);

        if (!Number.isFinite(cardmarketId) || !condition || !Number.isFinite(qty) || qty <= 0) {
          // sla over, maar noteer
          errors.push({ salesLogId: s.id, message: "invalid sale fields" });
          continue;
        }

        if (simulate) {
          wouldConsume.push({
            salesLogId: s.id,
            cardmarketId,
            isFoil,
            condition,
            qty,
          });
          continue;
        }

        await applyOneSale(s);
        processed++;
      } catch (e: any) {
        errors.push({ salesLogId: s.id, message: String(e?.message || e) });
        // ga door met de rest
      }
    }

    return NextResponse.json({
      ok: true,
      simulate,
      since: since.toISOString(),
      salesFound: sales.length,
      processed,
      wouldConsume: simulate ? wouldConsume : undefined,
      errors: errors.length ? errors : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
