import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SortKey = "set" | "name" | "maxQty";
type SortDir = "asc" | "desc";
type InvMode = "sumAll" | "bestSingle" | "strict";

function parseIntSafe(v: string | null, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normDir(v: string | null, fallback: SortDir): SortDir {
  return v === "asc" || v === "desc" ? v : fallback;
}

function normKey(v: string | null, fallback: SortKey): SortKey {
  return v === "set" || v === "name" || v === "maxQty" ? v : fallback;
}

function normInvMode(v: string | null, fallback: InvMode): InvMode {
  return v === "sumAll" || v === "bestSingle" || v === "strict" ? v : fallback;
}

function orderByFor(key: SortKey, dir: SortDir) {
  if (key === "set") return { setName: dir };
  if (key === "name") return { productName: dir };
  return { maxQty: dir };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const search = (url.searchParams.get("search") ?? "").trim();
    const setFilter = (url.searchParams.get("set") ?? "").trim();
    const condFilter = (url.searchParams.get("condition") ?? "").trim();

    const invMode = normInvMode(url.searchParams.get("invMode"), "sumAll");

    const primarySort = normKey(url.searchParams.get("sort1"), "maxQty");
    const primaryDir = normDir(url.searchParams.get("dir1"), "desc");
    const secondarySort = normKey(url.searchParams.get("sort2"), "set");
    const secondaryDir = normDir(url.searchParams.get("dir2"), "asc");

    const page = clamp(parseIntSafe(url.searchParams.get("page"), 1), 1, 10_000);
    const pageSize = clamp(parseIntSafe(url.searchParams.get("pageSize"), 150), 1, 200);
    const skip = (page - 1) * pageSize;

    // Search: naam contains OR tcgplayerId exact als numeriek
    const maybeId = search && /^\d+$/.test(search) ? Number(search) : null;

    const where: any = {};

    if (search) {
      where.OR = [
        { productName: { contains: search, mode: "insensitive" } },
        ...(maybeId != null ? [{ tcgplayerId: maybeId }] : []),
      ];
    }

    if (setFilter) {
      // ✅ dropdown => exact match, zodat "Edge of Eternities" niet ook Commander: ... meeneemt
      where.setName = { equals: setFilter, mode: "insensitive" };
    }

    if (condFilter) {
      where.condition = { equals: condFilter, mode: "insensitive" };
    }

    const orderBy: any[] = [];
    orderBy.push(orderByFor(primarySort, primaryDir));
    if (secondarySort !== primarySort) orderBy.push(orderByFor(secondarySort, secondaryDir));
    // stabiele tie-breakers
    orderBy.push({ productName: "asc" });
    orderBy.push({ tcgplayerId: "asc" });

    const [total, rows] = await Promise.all([
      prisma.sypDemand.count({ where }),
      prisma.sypDemand.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          tcgplayerId: true, // SKU id
          tcgProductId: true, // product id (matcht ScryfallLookup.tcgplayerId)
          category: true,
          productName: true,
          setName: true,
          collectorNumber: true,
          rarity: true,
          condition: true,
          marketPrice: true,
          maxQty: true,
          updatedAt: true,
          createdAt: true,
        },
      }),
    ]);

    // ✅ lookup key: tcgProductId (product) anders tcgplayerId (fallback)
    const lookupIds = Array.from(
      new Set(
        rows
          .map((r) => r.tcgProductId ?? r.tcgplayerId)
          .filter((x): x is number => typeof x === "number")
      )
    );

    const lookups = lookupIds.length
      ? await prisma.scryfallLookup.findMany({
          where: { tcgplayerId: { in: lookupIds } },
          select: {
            tcgplayerId: true,
            cardmarketId: true,
            set: true,
            collectorNumber: true,
            rarity: true,
          },
          orderBy: { updatedAt: "desc" },
        })
      : [];

    const lookupByProductId = new Map<number, (typeof lookups)[number]>();
    for (const l of lookups) {
      if (l.tcgplayerId == null) continue;
      if (!lookupByProductId.has(l.tcgplayerId)) lookupByProductId.set(l.tcgplayerId, l);
    }

    // cardmarketIds die we (kunnen) mappen
    const cmIds = Array.from(
      new Set(
        rows
          .map((r) => {
            const key = r.tcgProductId ?? r.tcgplayerId;
            return lookupByProductId.get(key)?.cardmarketId ?? null;
          })
          .filter((x): x is number => typeof x === "number")
      )
    );

    // Inventory matching
    // invMap:
    // - strict: key "cmid__cond"
    // - sumAll/bestSingle: key "cmid"
    const invMap = new Map<string, number>();

    if (cmIds.length) {
      if (invMode === "strict") {
        const invAgg = await prisma.inventoryBalance.groupBy({
          by: ["cardmarketId", "condition"],
          where: {
            cardmarketId: { in: cmIds },
            isFoil: false,
            language: "EN",
          },
          _sum: { qtyOnHand: true },
        });

        for (const g of invAgg) {
          invMap.set(`${g.cardmarketId}__${g.condition}`, g._sum.qtyOnHand ?? 0);
        }
      } else if (invMode === "bestSingle") {
        const rowsInv = await prisma.inventoryBalance.findMany({
          where: { cardmarketId: { in: cmIds } },
          select: { cardmarketId: true, qtyOnHand: true },
        });

        const best = new Map<number, number>();
        for (const r of rowsInv) {
          const cur = best.get(r.cardmarketId) ?? 0;
          if (r.qtyOnHand > cur) best.set(r.cardmarketId, r.qtyOnHand);
        }

        for (const [k, v] of best.entries()) invMap.set(String(k), v);
      } else {
        // default sumAll
        const invAgg = await prisma.inventoryBalance.groupBy({
          by: ["cardmarketId"],
          where: { cardmarketId: { in: cmIds } },
          _sum: { qtyOnHand: true },
        });

        for (const g of invAgg) {
          invMap.set(String(g.cardmarketId), g._sum.qtyOnHand ?? 0);
        }
      }
    }

    const items = rows.map((r) => {
      const productKey = r.tcgProductId ?? r.tcgplayerId;
      const l = lookupByProductId.get(productKey) ?? null;

      const cardmarketId = l?.cardmarketId ?? null;
      const cond = (r.condition ?? "").trim();

      const qtyHave =
        cardmarketId != null
          ? invMode === "strict"
            ? invMap.get(`${cardmarketId}__${cond}`) ?? 0
            : invMap.get(String(cardmarketId)) ?? 0
          : 0;

      const gap = Math.max(0, (r.maxQty ?? 0) - qtyHave);

      return {
        tcgplayerId: r.tcgplayerId,
        tcgProductId: r.tcgProductId,

        category: r.category,
        productName: r.productName,
        setName: r.setName,
        condition: r.condition,
        rarity: r.rarity,
        collectorNumber: r.collectorNumber,
        marketPrice: r.marketPrice ? Number(r.marketPrice) : null,
        maxQty: r.maxQty,

        cardmarketId,
        setCode: l?.set ?? null,

        qtyHave,
        gap,
      };
    });

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      items,
      debug: {
        invMode,
        sort1: `${primarySort}:${primaryDir}`,
        sort2: `${secondarySort}:${secondaryDir}`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
