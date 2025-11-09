// src/app/api/ops/apply-sales/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// -- Types
type SaleLike = {
  id: number;
  source: string | null;
  externalId: string | null;
  ts?: Date | null;            // aanwezig in DB; optioneel in type
  createdAt?: Date | null;     // fallback
  cardmarketId: number | null;
  blueprintId?: number | null; // niet vereist voor CM
  isFoil: boolean | null;
  condition: string | null;
  qty: number | null;
};

// --- helpers ---
const toBool = (b: any): boolean | null => {
  // ondersteunt booleans, 't'/'f', 'true'/'false', '1'/'0', 1/0
  if (b === true || b === false) return b;
  if (b === 1 || b === "1") return true;
  if (b === 0 || b === "0") return false;
  if (b === "t" || b === "T" || b === "true" || b === "TRUE") return true;
  if (b === "f" || b === "F" || b === "false" || b === "FALSE") return false;
  return null; // onbekend/vreemd
};

function validateCM(s: SaleLike) {
  const missing: string[] = [];

  const cmid = s.cardmarketId;
  const foil = toBool(s.isFoil);
  const cond = (s.condition ?? "").toString().trim();
  const qty  = s.qty;

  if (cmid == null || !Number.isInteger(cmid)) missing.push("cardmarketId");
  if (foil == null) missing.push("isFoil");
  if (!cond) missing.push("condition");
  if (qty == null || !Number.isInteger(qty) || qty <= 0) missing.push("qty");

  return {
    ok: missing.length === 0,
    normalized: {
      cardmarketId: Number(cmid),
      isFoil: foil ?? false,
      condition: cond.toUpperCase(),
      qty: Number(qty ?? 0),
      when: (s as any).ts ?? s.createdAt ?? new Date(),
    },
    missing,
  };
}

export async function POST(req: NextRequest) {
  try {
    // ---- Auth ----
    const isCron = req.headers.get("x-vercel-cron") === "1";
    const token = req.headers.get("x-admin-token");
    if (!isCron) {
    if (!token || token !== process.env.ADMIN_TOKEN) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

    // ---- Params ----
    const url = new URL(req.url);
    const sinceParam = url.searchParams.get("since");
    const simulate = url.searchParams.get("simulate") === "1";
    const limit = Number(url.searchParams.get("limit") || "0");
    const take = limit && limit > 0 ? limit : 500;

    // ---- since bepalen ----
    let since: Date | null = null;
    if (sinceParam) {
      const d = new Date(sinceParam);
      if (!isNaN(d.getTime())) since = d;
    }
    if (!since) {
      const cursor = await prisma.syncCursor.findUnique({ where: { key: "sales.apply.since" } });
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

    // ---- kandidaat-sales ophalen (idempotent via inventoryAppliedAt) ----
    const sales = await prisma.salesLog.findMany({
      where: { inventoryAppliedAt: null, ts: { gte: since } },
      take,
      orderBy: { ts: "asc" },
    });

    const wouldConsume: Array<{
      salesLogId: number;
      cardmarketId: number;
      isFoil: boolean;
      condition: string;
      qty: number;
    }> = [];

    const errors: Array<{ salesLogId: number; message: string; debug?: any }> = [];
    let processed = 0;

    // één sale verwerken (real run)
    async function applyOneSale(s: SaleLike, norm: ReturnType<typeof validateCM>["normalized"]) {
      const { cardmarketId, isFoil, condition, qty, when } = norm;

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
                ts: when,
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

        // 2) Balance afboeken — handmatig upsert om type-mismatch te vermijden
const existing = await tx.inventoryBalance.findFirst({
  where: { cardmarketId, isFoil, condition },
});

if (existing) {
  await tx.inventoryBalance.update({
    where: { id: existing.id }, // id is bigserial in jouw schema
    data: {
      qtyOnHand: { decrement: qty },
      lastSaleAt: when,
    },
  });
} else {
  await tx.inventoryBalance.create({
    data: {
      cardmarketId,
      isFoil,
      condition,
      qtyOnHand: -qty,
      avgUnitCostEur: null,
      lastSaleAt: when,
    },
  });
}


        // 3) Markeer toegepast
        const whereUnique: any =
          s.source && s.externalId
            ? { source_externalId: { source: s.source, externalId: s.externalId } }
            : { id: Number(s.id) };

        await tx.salesLog.update({
          where: whereUnique,
          data: { inventoryAppliedAt: new Date() },
        });
      });
    }

    // ---- hoofdloop ----
    for (const s of sales as SaleLike[]) {
      // CM-only pad (jouw 10 rijen zijn CM)
      const v = validateCM(s);
      if (!v.ok) {
        errors.push({ salesLogId: s.id, message: "invalid sale fields", debug: { missing: v.missing } });
        continue;
      }

      // optioneel: check of voorraad > 0 voor wouldConsume (handig in simulate)
      const bal = await prisma.inventoryBalance.findFirst({
        where: {
          cardmarketId: v.normalized.cardmarketId,
          isFoil: v.normalized.isFoil,
          condition: v.normalized.condition,
        },
        select: { qtyOnHand: true },
      });

      if (simulate) {
        if (bal && bal.qtyOnHand > 0) {
          wouldConsume.push({
            salesLogId: s.id,
            cardmarketId: v.normalized.cardmarketId,
            isFoil: v.normalized.isFoil,
            condition: v.normalized.condition,
            qty: Math.min(v.normalized.qty, bal.qtyOnHand),
          });
        } else {
          errors.push({
            salesLogId: s.id,
            message: "no stock to consume",
            debug: {
              key: {
                cardmarketId: v.normalized.cardmarketId,
                isFoil: v.normalized.isFoil,
                condition: v.normalized.condition,
              },
              qtyRequested: v.normalized.qty,
              qtyOnHand: bal?.qtyOnHand ?? 0,
            },
          });
        }
        continue;
      }

      try {
        await applyOneSale(s, v.normalized);
        processed++;
      } catch (e: any) {
        errors.push({ salesLogId: s.id, message: String(e?.message || e) });
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
