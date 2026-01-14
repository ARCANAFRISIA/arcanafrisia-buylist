export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computeUnitFromTrend, CondKey } from "@/lib/buylistEngineCore";
import { getPendingQtyByCardmarketId } from "@/lib/buylistPending";

type Item = {
  cardmarketId: number;
  foil?: boolean;     // true/false
  cond?: CondKey;     // "NM" | "EX" | "GD" | ...
  qty?: number;       // optional, alleen voor totals bij client
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const items: Item[] = body?.items ?? [];

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "items[] required" }, { status: 400 });
    }

    // dedupe ids
    const ids = Array.from(
      new Set(
        items
          .map((x) => Number(x.cardmarketId))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );

    if (!ids.length) {
      return NextResponse.json({ error: "no valid cardmarketIds" }, { status: 400 });
    }

    // 1) signals (trend/foilTrend/tix/edhrecRank/gameChanger)
    // Prisma model name kan verschillen; pas aan als jouw client anders heet.
    // Vaak: prisma.v_CardValueSignals, prisma.v_CardValueSignals.findMany, etc.
    const signals = await (prisma as any).v_CardValueSignals.findMany({
      where: { cardmarketId: { in: ids } },
      select: {
        cardmarketId: true,
        name: true,
        set: true,
        collectorNumber: true,
        rarity: true,

        trend: true,
        foilTrend: true,

        tix: true,
        edhrecRank: true,
        gameChanger: true,

        // optioneel debug
        ctMinPrice: true,
        ctOfferCount: true,
      },
    });

    const sigById = new Map<number, any>();
    for (const s of signals) sigById.set(s.cardmarketId, s);

    // 2) ownQty (inventory + pending) — net als search route
    const inv = await prisma.inventoryBalance.groupBy({
      where: { cardmarketId: { in: ids } },
      by: ["cardmarketId"],
      _sum: { qtyOnHand: true },
    });
    const onHandById = new Map<number, number>(
      inv.map((r) => [r.cardmarketId as number, r._sum.qtyOnHand ?? 0])
    );

    const pendingById = await getPendingQtyByCardmarketId(ids);

    // 3) quote per item
    const results = items.map((it) => {
      const id = Number(it.cardmarketId);
      const foil = !!it.foil;
      const cond: CondKey = (it.cond ?? "NM") as CondKey;

      const sig = sigById.get(id) ?? null;

      if (!sig) {
        return {
          cardmarketId: id,
          ok: false,
          error: "NO_SIGNALS",
        };
      }

      const ownOnHand = onHandById.get(id) ?? 0;
      const ownPending = pendingById.get(id) ?? 0;
      const ownQty = ownOnHand + ownPending;

      const engine = computeUnitFromTrend({
        trend: sig.trend ?? null,
        trendFoil: sig.foilTrend ?? null,
        isFoil: foil,
        cond,
        ctx: {
          edhrecRank: sig.edhrecRank ?? null,
          mtgoTix: sig.tix ?? null,
          gameChanger: sig.gameChanger ?? false,
          ownQty,
        },
      });

      return {
        cardmarketId: id,
        ok: true,

        name: sig.name,
        set: sig.set,
        collectorNumber: sig.collectorNumber ?? null,
        rarity: sig.rarity ?? null,

        foil,
        cond,

        // engine output
        allowed: engine.allowed,
        unit: engine.unit,
        pct: engine.pct,
        usedTrend: engine.usedTrend,

        // debug/context
        trendNonFoil: sig.trend ?? null,
        trendFoil: sig.foilTrend ?? null,
        edhrecRank: sig.edhrecRank ?? null,
        tix: sig.tix ?? null,
        gameChanger: sig.gameChanger ?? false,
        ownQty,
      };
    });

    return NextResponse.json({
      ok: true,
      count: results.length,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "internal error" }, { status: 500 });
  }
}
