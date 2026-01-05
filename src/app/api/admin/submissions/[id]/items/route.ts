// src/app/api/admin/submissions/[id]/items/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computeUnitFromTrend, type CondKey } from "@/lib/buylistEngineCore";

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

function isClientNewId(id: any) {
  const s = String(id ?? "");
  return s.startsWith("new-");
}

const toNumber = (v: any) => (v == null ? null : Number((v as any).toString?.() ?? v));

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

    // Map input patches snel op id
    const patchById = new Map<string, any>();
    for (const p of itemsIn) {
      if (!p?.id) continue;
      patchById.set(String(p.id), p);
    }

    // --- Bestaande items ---
    const existingById = new Map<string, (typeof submission.items)[number]>();
    for (const it of submission.items) existingById.set(it.id, it);

    // Opsplitsen in:
    // - deletes (existing id + qty<=0)
    // - updates (existing id + qty>0)
    // - creates (new- id OR isNew true) + qty>0
    const deletes: string[] = [];
    const updatesInput: Array<{
      id: string;
      cmId: number;
      qty: number;
      isFoil: boolean;
      condition: CondKey;
      collectorNumber: string | null;
    }> = [];

    const createsInput: Array<{
      clientId: string; // "new-..."
      cmId: number;
      qty: number;
      isFoil: boolean;
      condition: CondKey;
      collectorNumber: string | null;
      // we nemen ook naam/set hints mee (kan leeg), maar backend zal meta override’en
      cardNameHint?: string | null;
      setCodeHint?: string | null;
    }> = [];

    for (const p of itemsIn) {
      const pid = String(p?.id ?? "");
      if (!pid) continue;

      const qty = Number(p.qty ?? 0);
      const cmId = Number(p.cmId ?? 0);
      const isFoil = Boolean(p.isFoil);
      const condition = mapCond(p.condition);
      const collectorNumber = (p.collectorNumber as string | null) ?? null;

      const wantsCreate = Boolean(p.isNew) || isClientNewId(pid);

      if (wantsCreate) {
        // split-row: alleen aanmaken als qty>0 en cmId valide
        if (qty <= 0) continue;
        if (!Number.isFinite(cmId) || cmId <= 0) continue;

        createsInput.push({
          clientId: pid,
          cmId,
          qty,
          isFoil,
          condition,
          collectorNumber,
          cardNameHint: (p.name as string | null) ?? null,
          setCodeHint: (p.set as string | null) ?? (p.setCode as string | null) ?? null,
        });
        continue;
      }

      // update/delete bestaande
      const existing = existingById.get(pid);
      if (!existing) {
        // onbekend id → negeren (veilig)
        continue;
      }

      if (qty <= 0) {
        deletes.push(existing.id);
        continue;
      }

      // cmId fallback op bestaande productId
      const finalCmId = Number.isFinite(cmId) && cmId > 0 ? cmId : Number(existing.productId);

      updatesInput.push({
        id: existing.id,
        cmId: finalCmId,
        qty,
        isFoil,
        condition,
        collectorNumber,
      });
    }

    // Universe van cmIds (updates + creates) om pricing/meta in 1x te laden
    const cmIds = Array.from(
      new Set([
        ...updatesInput.map((u) => u.cmId),
        ...createsInput.map((c) => c.cmId),
      ].filter((n) => Number.isFinite(n) && n > 0))
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

    function computePricing(args: {
      cmId: number;
      qty: number;
      isFoil: boolean;
      condition: CondKey;
    }) {
      const { cmId, qty, isFoil, condition } = args;
      const guide = guideById.get(cmId) ?? { trend: null, foilTrend: null };
      const meta = metaById.get(cmId) ?? null;
      const ownQty = ownQtyById.get(cmId) ?? 0;

      const { unit, pct, usedTrend, allowed } = computeUnitFromTrend({
        trend: guide.trend,
        trendFoil: guide.foilTrend,
        isFoil,
        cond: condition,
        ctx: {
          ownQty,
          edhrecRank: meta?.edhrecRank ?? null,
          mtgoTix: meta?.tix ?? null,
          gameChanger: meta?.gameChanger ?? null,
        },
      });

      let unitCents = 0;
      let lineCents = 0;
      let trendCents: number | null = null;
      let trendFoilCents: number | null = null;
      let pctInt: number | null = null;

      if (allowed && unit && unit > 0 && qty > 0) {
        unitCents = Math.round(unit * 100);
        lineCents = unitCents * qty;

        const used = usedTrend != null ? usedTrend : guide.trend;
        trendCents = used != null ? Math.round(Number(used) * 100) : null;
        trendFoilCents =
          guide.foilTrend != null ? Math.round(Number(guide.foilTrend) * 100) : null;
        pctInt = Math.round(pct * 100);
      } else {
        // not allowed → unit blijft 0, line wordt 0 (strak)
        unitCents = 0;
        lineCents = 0;
        trendCents = guide.trend != null ? Math.round(Number(guide.trend) * 100) : null;
        trendFoilCents =
          guide.foilTrend != null ? Math.round(Number(guide.foilTrend) * 100) : null;
        pctInt = null;
      }

      return { unitCents, lineCents, trendCents, trendFoilCents, pctInt, meta };
    }

    // --- Prisma ops bouwen ---
    const ops: any[] = [];
    const createClientIds: string[] = []; // parallel met create results indices

    // Deletes
    if (deletes.length) {
      ops.push(
        prisma.submissionItem.deleteMany({
          where: { id: { in: deletes }, submissionId: id },
        })
      );
    }

    // Updates (recalc)
    for (const u of updatesInput) {
      const pricing = computePricing({
        cmId: u.cmId,
        qty: u.qty,
        isFoil: u.isFoil,
        condition: u.condition,
      });

      const metaName = pricing.meta?.name ?? null;
      const metaSet = pricing.meta?.set ?? null;
      const metaColl = u.collectorNumber ?? pricing.meta?.collectorNumber ?? null;

      ops.push(
        prisma.submissionItem.update({
          where: { id: u.id },
          data: {
            productId: BigInt(u.cmId),
            qty: u.qty,
            isFoil: u.isFoil,
            condition: u.condition,
            collectorNumber: metaColl,
            trendCents: pricing.trendCents,
            trendFoilCents: pricing.trendFoilCents,
            unitCents: pricing.unitCents,
            lineCents: pricing.lineCents,
            pct: pricing.pctInt,
            cardName: metaName,
            setCode: metaSet,
          },
        })
      );
    }

    // Creates (split rows)
    for (const c of createsInput) {
      const pricing = computePricing({
        cmId: c.cmId,
        qty: c.qty,
        isFoil: c.isFoil,
        condition: c.condition,
      });

      const metaName = pricing.meta?.name ?? c.cardNameHint ?? null;
      const metaSet = pricing.meta?.set ?? c.setCodeHint ?? null;
      const metaColl = c.collectorNumber ?? pricing.meta?.collectorNumber ?? null;

      createClientIds.push(c.clientId);

      ops.push(
        prisma.submissionItem.create({
          data: {
            submissionId: id,
            productId: BigInt(c.cmId),
            qty: c.qty,
            isFoil: c.isFoil,
            condition: c.condition,
            collectorNumber: metaColl,
            trendCents: pricing.trendCents,
            trendFoilCents: pricing.trendFoilCents,
            unitCents: pricing.unitCents,
            lineCents: pricing.lineCents,
            pct: pricing.pctInt,
            cardName: metaName,
            setCode: metaSet,
          },
        })
      );
    }

    // Voer alles uit
    const results = ops.length ? await prisma.$transaction(ops) : [];

    // Mapping clientId -> new real id (alleen voor creates)
    // results bevat: [deleteManyResult? , ...updates, ...creates]
    // We weten niet exact offset, dus berekenen:
    const deleteOffset = deletes.length ? 1 : 0;
    const updateCount = updatesInput.length;
    const createCount = createsInput.length;

    const createdMap: Record<string, string> = {};
    if (createCount > 0) {
      const start = deleteOffset + updateCount;
      for (let i = 0; i < createCount; i++) {
        const created = results[start + i];
        const clientId = createClientIds[i];
        if (created?.id && clientId) createdMap[clientId] = String(created.id);
      }
    }

    // Re-load saved items and update totals
 const savedItems = await prisma.submissionItem.findMany({
  where: { submissionId: id },
  orderBy: [{ id: "asc" }], // of helemaal weglaten
});


    const totalCents = savedItems.reduce(
      (s, it) => s + Number(it.lineCents ?? 0),
      0
    );

    await prisma.submission.update({
      where: { id },
      data: {
        serverTotalCents: totalCents,
        subtotalCents: totalCents,
      },
    });

    // Response payload voor frontend
    const respItems = savedItems.map((it) => {
      const cmId = Number(it.productId);
      const meta = metaById.get(cmId) ?? null;
      return {
        id: it.id,
        cmId,
        name: (it as any).cardName ?? meta?.name ?? `#${cmId}`,
        setCode: (it as any).setCode ?? meta?.set ?? null,
        collectorNumber: (it as any).collectorNumber ?? meta?.collectorNumber ?? null,
        condition: (it.condition as string | null) ?? "NM",
        isFoil: it.isFoil,
        qty: it.qty,
        unitCents: Number(it.unitCents ?? 0),
        lineCents: Number(it.lineCents ?? 0),
      };
    });

    return NextResponse.json(
      jsonSafe({
        ok: true,
        items: respItems,
        totalCents,
        createdMap, // 🔥 client new-id -> db id
      })
    );
  } catch (e: any) {
    console.error("[admin items PATCH] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 }
    );
  }
}
