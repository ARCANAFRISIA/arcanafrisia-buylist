// src/app/api/admin/location/worklist/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROW_CAPACITY = 900;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function rowKey(drawer: string, row: number) {
  return `${drawer}${pad2(row)}`; // e.g. C01
}

function parseLoc(loc: string | null | undefined): { drawer: string; row: number; batch: number } | null {
  const s = (loc ?? "").trim();
  const m = s.match(/^([A-J])(\d{2})\.(\d{2})$/);
  if (!m) return null;
  return { drawer: m[1], row: Number(m[2]), batch: Number(m[3]) };
}

function allowedRowsC() {
  return [{ drawer: "C", rows: [1, 2, 3, 4, 5, 6] }];
}

async function getRowUsageC() {
  const rows = await prisma.inventoryLot.findMany({
    where: {
      qtyRemaining: { gt: 0 },
      location: { not: null, startsWith: "C" },
    },
    select: { location: true, qtyRemaining: true },
  });

  const usedByRow = new Map<string, number>();
  for (const l of rows) {
    const p = parseLoc(l.location);
    if (!p) continue;
    if (p.drawer !== "C") continue;
    if (p.row < 1 || p.row > 6) continue;

    const rk = rowKey("C", p.row);
    usedByRow.set(rk, (usedByRow.get(rk) ?? 0) + Number(l.qtyRemaining ?? 0));
  }
  return usedByRow;
}

function chooseSuggestedLocation(usedByRow: Map<string, number>) {
  const groups = allowedRowsC();

  for (const g of groups) {
    for (const r of g.rows) {
      const rk = rowKey(g.drawer, r);
      const used = usedByRow.get(rk) ?? 0;
      if (used >= ROW_CAPACITY) continue;
      return `${g.drawer}${pad2(r)}.01`;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const includeLots = url.searchParams.get("includeLots") !== "0"; // default true

  // 1) alle balances + qtyOnHand > 0
  const balances = await prisma.inventoryBalance.findMany({
    where: { qtyOnHand: { gt: 0 } },
    select: { cardmarketId: true, isFoil: true, condition: true, language: true, qtyOnHand: true },
  });

  const cmIds = Array.from(new Set(balances.map((b) => Number(b.cardmarketId)).filter(Number.isFinite)));

  if (!cmIds.length) {
    return NextResponse.json({ ok: true, count: 0, items: [] });
  }

  // 2) cmid -> scryfallId + meta
  const lookups = await prisma.scryfallLookup.findMany({
    where: { cardmarketId: { in: cmIds } },
    select: { cardmarketId: true, scryfallId: true, name: true, set: true, collectorNumber: true },
  });

  const scryByCmid = new Map<number, string>();
  const metaByCmid = new Map<number, { name: string; set: string; collectorNumber: string | null }>();

  for (const l of lookups) {
    if (l.scryfallId) scryByCmid.set(Number(l.cardmarketId), l.scryfallId);
    metaByCmid.set(Number(l.cardmarketId), {
      name: l.name,
      set: l.set,
      collectorNumber: l.collectorNumber ?? null,
    });
  }

  // 3) stockpolicy in bulk (alleen REGULAR/CTBULK + sypHot)
  const scryIds = Array.from(new Set(Array.from(scryByCmid.values())));
  const policies = scryIds.length
    ? await prisma.stockPolicy.findMany({
        where: { scryfallId: { in: scryIds } },
        select: { scryfallId: true, stockClass: true, sypHot: true },
      })
    : [];

  const polByScry = new Map<string, { stockClass: "REGULAR" | "CTBULK"; sypHot: boolean }>();
  for (const p of policies) {
    const sc = (String(p.stockClass).toUpperCase() as any) === "CTBULK" ? "CTBULK" : "REGULAR";
    polByScry.set(p.scryfallId, { stockClass: sc, sypHot: !!p.sypHot });
  }

  // 4) row usage voor C01..C06
  const usedByRow = await getRowUsageC();

  // 5) lots ophalen (optioneel)
  const lots = includeLots
    ? await prisma.inventoryLot.findMany({
        where: { cardmarketId: { in: cmIds }, qtyRemaining: { gt: 0 } },
        select: {
          id: true,
          cardmarketId: true,
          isFoil: true,
          condition: true,
          language: true,
          qtyRemaining: true,
          sourceCode: true,
          sourceDate: true,
          location: true,
        },
        orderBy: [{ sourceDate: "asc" }, { createdAt: "asc" }],
      })
    : [];

  const lotsBySkuKey = new Map<string, typeof lots>();
  if (includeLots) {
    for (const l of lots) {
      const key = `${l.cardmarketId}|${l.isFoil ? 1 : 0}|${(l.condition || "NM").toUpperCase()}|${(l.language || "EN").toUpperCase()}`;
      const arr = lotsBySkuKey.get(key) ?? [];
      arr.push(l as any);
      lotsBySkuKey.set(key, arr as any);
    }
  }

  // 6) build items (alles)
  const items: any[] = [];

  for (const b of balances) {
    const cmid = Number(b.cardmarketId);
    const scry = scryByCmid.get(cmid);
    if (!scry) continue;

    const meta = metaByCmid.get(cmid);
    if (!meta) continue;

    const pol = polByScry.get(scry) ?? { stockClass: "REGULAR" as const, sypHot: false };

    const cond = (b.condition || "NM").toUpperCase();
    const lang = (b.language || "EN").toUpperCase();
    const skuKey = `${cmid}|${b.isFoil ? 1 : 0}|${cond}|${lang}`;

    const skuLots = includeLots ? (lotsBySkuKey.get(skuKey) ?? []) : [];
    const currentLocations = Array.from(
      new Set(skuLots.map((l) => (l.location ?? "").trim()).filter((x) => x.length > 0))
    );

    const suggestedLocation = chooseSuggestedLocation(usedByRow);

    items.push({
      skuKey,
      cardmarketId: cmid,
      name: meta.name,
      set: meta.set,
      collectorNumber: meta.collectorNumber,
      isFoil: !!b.isFoil,
      condition: cond,
      language: lang,
      qtyOnHand: Number(b.qtyOnHand ?? 0),
      stockClass: pol.stockClass,
      sypHot: pol.sypHot,
      currentLocations,
      suggestedLocation,
      lots: skuLots.map((l) => ({
        id: l.id,
        qtyRemaining: Number(l.qtyRemaining ?? 0),
        sourceCode: l.sourceCode,
        sourceDate: l.sourceDate,
        location: l.location ?? null,
      })),
    });
  }

  // sort: CTBULK first (handig om bulk te fixen), daarna naam
  items.sort((a, b) => {
    const ca = a.stockClass === "CTBULK" ? 0 : 1;
    const cb = b.stockClass === "CTBULK" ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return String(a.name).localeCompare(String(b.name));
  });

  return NextResponse.json({ ok: true, count: items.length, items });
}
