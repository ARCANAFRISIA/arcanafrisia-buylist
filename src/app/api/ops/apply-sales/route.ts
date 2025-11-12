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

function normalizeCMCondition(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const map: Record<string, string> = {
    // CM set
    "M": "MT", "MT": "MT", "MINT": "MT",

    "NM": "NM", "NEAR MINT": "NM", "NEARMINT": "NM", "NEAR_MINT": "NM",

    "EX": "EX", "EXCELLENT": "EX", "SLIGHTLY PLAYED": "EX",
    "SLIGHTLY-PLAYED": "EX", "SP": "EX",

    "GD": "GD", "GOOD": "GD", "Moderately Played": "GD",
    "Moderately-Played": "GD", "MP": "GD", "MODERATELY PLAYED": "GD",

    "LP": "LP", "LIGHT PLAYED": "LP", "LIGHTLY PLAYED": "LP", "LIGHT-PLAYED": "LP",

    "PL": "PL", "PLAYED": "PL",

    "PO": "PO", "P": "PO", "POOR": "PO",
  };
  return map[s] ?? s; // als onbekend, laat omhoog gecapte string staan
}




function validateCM(s: SaleLike) {
  const missing: string[] = [];

  const cmid = s.cardmarketId;
  const foil = toBool(s.isFoil);
  const cond = normalizeCMCondition((s.condition ?? "").toString()); // ⬅️ hier
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
      condition: cond,                       // ⬅️ genormaliseerd
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

    const onlySource = url.searchParams.get("onlySource");     // bv. "CT" of "CM"
    const onlyCtOrderId = url.searchParams.get("ctOrderId");   // bv. "123456789"
    const idsParam = url.searchParams.get("ids");              // bv. "441191,441190"

    // ---- since bepalen ----
    let since: Date | null = null;

// 1) querystring
if (sinceParam) {
  const d = new Date(sinceParam);
  if (!isNaN(d.getTime())) since = d;
}

// 2) cursor fallback
if (!since) {
  const cursor = await prisma.syncCursor.findUnique({
    where: { key: "sales.apply.since" },
  });
  if (cursor?.value) {
    const d = new Date(cursor.value);
    if (!isNaN(d.getTime())) since = d;
  }
}
    const hasExplicitSelection =
  !!onlyCtOrderId || !!idsParam; // gericht selecteren

// since mag ontbreken als we expliciet selecteren
if (!hasExplicitSelection && !since) {
  return NextResponse.json(
    { ok: false, error: "missing since (provide ?since=... or set SyncCursor sales.apply.since)" },
    { status: 400 },
  );
}

const where: any = { inventoryAppliedAt: null };

if (!hasExplicitSelection && since) where.ts = { gte: since };
if (onlySource) where.source = onlySource;
if (onlyCtOrderId) {
  where.ctOrderId = Number(onlyCtOrderId);
  // optioneel strakker: CT-only als je ctOrderId gebruikt
  if (!onlySource) where.source = "CT";
}
if (idsParam) {
  const ids = idsParam.split(",").map(x => Number(x.trim())).filter(n => Number.isInteger(n));
  if (ids.length) where.id = { in: ids };
}

    // ---- kandidaat-sales ophalen (idempotent via inventoryAppliedAt) ----
    const sales = await prisma.salesLog.findMany({ where, take, orderBy: { ts: "asc" } });


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
  where: {
    cardmarketId,
    isFoil,
    condition,
    qtyRemaining: { gt: 0 },
    sourceDate: { lte: when },        // ⬅️ verbruik geen voorraad na de sale-tijd
  },
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

      // ---- SIMULATE: kijk eerst naar Balance; zo niet, val terug op Lots (met cutoff op sale.ts) ----
if (simulate) {
  const cutoff = v.normalized.when; // verbruik geen voorraad die na de sale is binnengekomen

  // 1) Balance
  const bal = await prisma.inventoryBalance.findFirst({
    where: {
      cardmarketId: v.normalized.cardmarketId,
      isFoil: v.normalized.isFoil,
      condition: v.normalized.condition,
    },
    select: { qtyOnHand: true },
  });

  let avail = bal?.qtyOnHand ?? 0;

  // 2) Fallback: Lots (alleen wat al binnen was vóór/óp de sale)
  if (!avail || avail <= 0) {
    const lotsAgg = await prisma.inventoryLot.aggregate({
      _sum: { qtyRemaining: true },
      where: {
        cardmarketId: v.normalized.cardmarketId,
        isFoil: v.normalized.isFoil,
        condition: v.normalized.condition,
        qtyRemaining: { gt: 0 },
        ...(cutoff ? { sourceDate: { lte: cutoff } } : {}), // cutoff is belangrijk
      },
    });
    avail = Number(lotsAgg._sum.qtyRemaining ?? 0);
  }

  if (avail > 0) {
    wouldConsume.push({
      salesLogId: s.id,
      cardmarketId: v.normalized.cardmarketId,
      isFoil: v.normalized.isFoil,
      condition: v.normalized.condition,
      qty: Math.min(v.normalized.qty, avail),
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
        // voor diagnose:
        qtyOnHand: bal?.qtyOnHand ?? 0,
        lotsQtyRemaining: avail,
        cutoff: cutoff?.toISOString() ?? null,
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
