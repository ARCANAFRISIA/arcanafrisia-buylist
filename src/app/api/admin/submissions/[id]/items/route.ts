export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  computeUnitFromTrend,
  type CondKey,
} from "@/lib/buylistEngineCore";

// helper: BigInt → number safe JSON
function jsonSafe<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

function mapCond(raw: any): CondKey {
  const s = String(raw ?? "NM").toUpperCase().trim();
  if (s === "NM" || s === "EX" || s === "GD" || s === "LP" || s === "PL" || s === "PO") {
    return s as CondKey;
  }
  return "NM";
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const itemsIn = Array.isArray(body.items) ? body.items : [];

    if (!itemsIn.length) {
      return NextResponse.json(
        { ok: false, error: "Geen items in payload" },
        { status: 400 }
      );
    }

    const submission = await prisma.submission.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!submission) {
      return NextResponse.json(
        { ok: false, error: "Submission niet gevonden" },
        { status: 404 }
      );
    }

    // bestaande items mappen op id
    const byId = new Map(
      submission.items.map((it) => [it.id, it])
    );

    // 1) input toepassen op memory-kopie (qty/cond/foil/collector/cmId)
    const updatedItems = submission.items.map((it) => {
      const patch = itemsIn.find((p: any) => p.id === it.id);
      if (!patch) return it;

      const cmId = Number(patch.cmId ?? it.productId);
      return {
        ...it,
        productId: BigInt(cmId),
        qty: Number(patch.qty ?? it.qty),
        isFoil: Boolean(patch.isFoil ?? it.isFoil),
        condition: String(patch.condition ?? it.condition ?? "NM"),
        collectorNumber:
          (patch.collectorNumber as string | null) ??
          (it.collectorNumber as string | null) ??
          null,
      };
    });

    // alle cardmarketIds na wijzigingen
    const cmIds = Array.from(
      new Set(
        updatedItems
          .map((it) => Number(it.productId))
          .filter((n) => Number.isFinite(n))
      )
    ) as number[];

    // priceguide + eigen voorraad + meta ophalen
    const [guides, inv, scryMeta] = await Promise.all([
      prisma.cMPriceGuide.findMany({
        where: { cardmarketId: { in: cmIds } },
        select: { cardmarketId: true, trend: true, foilTrend: true },
      }),
      prisma.inventoryBalance.groupBy({
        where: { cardmarketId: { in: cmIds } },
        by: ["cardmarketId"],
        _sum: { qtyOnHand: true },
      }),
      prisma.scryfallLookup.findMany({
        where: { cardmarketId: { in: cmIds } },
        select: {
          cardmarketId: true,
          name: true,
          set: true,
          collectorNumber: true,
          tix: true,
          edhrecRank: true,
          gameChanger: true,
        },
      }),
    ]);

    const toNumber = (v: any) =>
      v == null ? null : Number((v as any).toString?.() ?? v);

    const guideById = new Map<number, { trend: number | null; foilTrend: number | null }>();
    for (const g of guides) {
      guideById.set(g.cardmarketId as number, {
        trend: toNumber(g.trend),
        foilTrend: toNumber(g.foilTrend),
      });
    }

    const ownQtyById = new Map<number, number>();
    for (const row of inv) {
      ownQtyById.set(row.cardmarketId as number, row._sum.qtyOnHand ?? 0);
    }

    const metaById = new Map<
      number,
      {
        name: string;
        set: string | null;
        collectorNumber: string | null;
        tix: number | null;
        edhrecRank: number | null;
        gameChanger: boolean | null;
      }
    >();
    for (const m of scryMeta) {
      metaById.set(m.cardmarketId as number, {
        name: m.name,
        set: m.set,
        collectorNumber: (m.collectorNumber as string | null) ?? null,
        tix: m.tix == null ? null : Number(m.tix),
        edhrecRank: (m.edhrecRank as number | null) ?? null,
        gameChanger: (m.gameChanger as boolean | null) ?? null,
      });
    }

    // 2) per item opnieuw prijs uitrekenen
    let totalCents = 0;

    const updates = [];
    for (const it of updatedItems) {
      const cmId = Number(it.productId);
      const qty = Number(it.qty ?? 0);
      const isFoil = Boolean(it.isFoil);
      const condKey = mapCond(it.condition);

      const guide = guideById.get(cmId) ?? { trend: null, foilTrend: null };
      const meta = metaById.get(cmId) ?? null;
      const ownQty = ownQtyById.get(cmId) ?? 0;

      const { unit, pct, usedTrend, allowed } = computeUnitFromTrend({
        trend: guide.trend,
        trendFoil: guide.foilTrend,
        isFoil,
        cond: condKey,
        ctx: {
          ownQty,
          edhrecRank: meta?.edhrecRank ?? null,
          mtgoTix: meta?.tix ?? null,
          gameChanger: meta?.gameChanger ?? null,
        },
      });

      let unitCents = Number(it.unitCents ?? 0);
      let lineCents = Number(it.lineCents ?? 0);
      let trendCents: number | null = it.trendCents ?? null;
      let trendFoilCents: number | null = it.trendFoilCents ?? null;
      let pctInt: number | null = it.pct ?? null;

      if (allowed && unit && unit > 0 && qty > 0) {
        unitCents = Math.round(unit * 100);
        lineCents = unitCents * qty;
        trendCents =
          usedTrend != null
            ? Math.round(usedTrend * 100)
            : guide.trend != null
            ? Math.round(guide.trend * 100)
            : null;
        trendFoilCents =
          guide.foilTrend != null
            ? Math.round(guide.foilTrend * 100)
            : null;
        pctInt = Math.round(pct * 100);
      } else {
        // niet allowed → laat unit maar staan, zet line = unit*qty
        unitCents = Number(it.unitCents ?? 0);
        lineCents = unitCents * qty;
      }

      totalCents += lineCents;

      const metaName = meta?.name ?? (it as any).cardName ?? null;
      const metaSet = meta?.set ?? (it as any).setCode ?? null;
      const metaColl =
        it.collectorNumber ??
        meta?.collectorNumber ??
        ((it as any).collectorNumber as string | null) ??
        null;

      updates.push(
        prisma.submissionItem.update({
          where: { id: it.id },
          data: {
            productId: BigInt(cmId),
            qty,
            isFoil,
            condition: condKey,
            collectorNumber: metaColl,
            trendCents,
            trendFoilCents,
            unitCents,
            lineCents,
            pct: pctInt,
            cardName: metaName,
            setCode: metaSet,
          },
        })
      );
    }

    // 3) eerst alle item-updates in één transaction uitvoeren
    await prisma.$transaction(updates);

    // daarna opnieuw inladen + totals opslaan
    const [savedItems] = await Promise.all([
      prisma.submissionItem.findMany({
        where: { submissionId: id },
      }),
      prisma.submission.update({
        where: { id },
        data: {
          serverTotalCents: totalCents,
          subtotalCents: totalCents,
        },
      }),
    ]);

    // 4) response payload voor frontend
    const respItems = savedItems.map((it) => {

      const cmId = Number(it.productId);
      const meta = metaById.get(cmId) ?? null;
      return {
        id: it.id,
        cmId,
        name: (it as any).cardName ?? meta?.name ?? `#${cmId}`,
        setCode: (it as any).setCode ?? meta?.set ?? null,
        collectorNumber:
          (it as any).collectorNumber ??
          meta?.collectorNumber ??
          null,
        condition: (it.condition as string | null) ?? "NM",
        isFoil: it.isFoil,
        qty: it.qty,
        unitCents: Number(it.unitCents ?? 0),
        lineCents: Number(it.lineCents ?? 0),
      };
    });

    return NextResponse.json(
      jsonSafe({ ok: true, items: respItems, totalCents })
    );
  } catch (e: any) {
    console.error("[admin items PATCH] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 }
    );
  }
}
