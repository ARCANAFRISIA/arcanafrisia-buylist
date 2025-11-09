import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = {
  cardmarketId: number;
  isFoil: boolean;
  condition: string;
  sourceCode: string | null;
  sourceDate: Date | null;
  qtyIn: number;                 // totale inname (info)
  qtyRemaining?: number | null;  // optioneel in CSV; we caps anyway
  location?: string | null;
  avgUnitCostEur?: number | null;
};

function parseBool(v: string) {
  const s = (v ?? "").toString().trim().toLowerCase();
  return s === "true" || s === "1" || s === "t" || s === "waar" || s === "onwaar" ? s === "waar" || s === "true" || s === "t" || s === "1" : s === "foil" ? true : s === "nonfoil" ? false : s === "yes";
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  const header = lines.shift()!;
  const cols = header.split(",").map(c => c.trim());
  const idx = (name: string) => cols.findIndex(c => c.toLowerCase() === name.toLowerCase());

  const iCmid = idx("cardmarketId");
  const iFoil = idx("isFoil");
  const iCond = idx("condition");
  const iSrc  = idx("sourceCode");
  const iDate = idx("sourceDate");
  const iQty  = idx("qtyIn");
  const iRem  = idx("qtyRemaining");
  const iLoc  = idx("location");
  const iCost = idx("avgUnitCostEur");

  if (iCmid < 0 || iFoil < 0 || iCond < 0 || iSrc < 0 || iDate < 0 || iQty < 0)
    throw new Error("CSV headers required: cardmarketId,isFoil,condition,sourceCode,sourceDate,qtyIn[,qtyRemaining,location,avgUnitCostEur]");

  const rows: Row[] = [];
  for (const line of lines) {
    const parts = line.split(","); // eenvoudig (geen quotes-support); evt. verbeteren later
    const cmid = Number(parts[iCmid]);
    const isFoil = parseBool(parts[iFoil]);
    const cond = (parts[iCond] ?? "").toUpperCase();
    const sourceCode = (parts[iSrc] ?? "").trim() || null;
    const sourceDate = parts[iDate] ? new Date(parts[iDate]) : null;
    const qtyIn = Number(parts[iQty] ?? 0);
    const qtyRemaining = iRem >= 0 ? Number(parts[iRem] ?? 0) : null;
    const location = iLoc >= 0 ? (parts[iLoc] ?? "").trim() || null : null;
    const avgUnitCostEur = iCost >= 0 ? (parts[iCost] ? Number(parts[iCost]) : null) : null;

    if (!Number.isFinite(cmid) || !cond || !Number.isFinite(qtyIn)) continue;
    rows.push({ cardmarketId: cmid, isFoil, condition: cond, sourceCode, sourceDate, qtyIn, qtyRemaining, location, avgUnitCostEur });
  }
  return rows;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-admin-token");
  if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";          // dry-run
  const mode = (url.searchParams.get("mode") || "backfill").toLowerCase(); // only backfill supported
  if (mode !== "backfill") return new Response(JSON.stringify({ ok: false, error: "unsupported mode" }), { status: 400 });

  const text = await req.text();
  let rows: Row[];
  try {
    rows = parseCsv(text);
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 400 });
  }
  if (!rows.length) return new Response(JSON.stringify({ ok: false, error: "no rows" }), { status: 400 });

  // groepeer per sleutel
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.cardmarketId}|${r.isFoil ? 1 : 0}|${r.condition}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }

  // haal balances op
  const keys = Array.from(byKey.keys());
  const cmids = Array.from(new Set(rows.map(r => r.cardmarketId)));
  const balances = await prisma.inventoryBalance.findMany({
    where: { cardmarketId: { in: cmids } },
    select: { cardmarketId: true, isFoil: true, condition: true, qtyOnHand: true }
  });
  const balMap = new Map<string, number>();
  for (const b of balances) balMap.set(`${b.cardmarketId}|${b.isFoil ? 1 : 0}|${b.condition}`, b.qtyOnHand);

  const planned: any[] = [];
  for (const key of keys) {
    const [cmidStr, foilStr, cond] = key.split("|");
    const cmid = Number(cmidStr);
    const isFoil = foilStr === "1";
    const onHand = balMap.get(key) ?? 0;

    // Sorteer FIFO op sourceDate
    const lotRows = byKey.get(key)!.slice().sort((a,b) => {
      const ta = a.sourceDate ? a.sourceDate.getTime() : 0;
      const tb = b.sourceDate ? b.sourceDate.getTime() : 0;
      return ta - tb;
    });

    let remainingBudget = Math.max(onHand, 0); // we willen dat som(qtyRemaining) == onHand
    for (const r of lotRows) {
      if (remainingBudget <= 0) break;
      const desired = Number.isFinite(r.qtyRemaining ?? NaN) && (r.qtyRemaining as number) >= 0
        ? (r.qtyRemaining as number)
        : r.qtyIn;

      const take = Math.min(desired, remainingBudget);
      remainingBudget -= take;

      planned.push({
        cardmarketId: cmid,
        isFoil,
        condition: cond,
        qtyIn: r.qtyIn,
        qtyRemaining: take,
        avgUnitCostEur: r.avgUnitCostEur ?? null,
        sourceCode: r.sourceCode ?? null,
        sourceDate: r.sourceDate ?? new Date(),
        location: r.location ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    // als budget nog > 0 en we hadden geen rijen: maak 1 synthetic lot (sourceCode='BACKFILL')
    if (lotRows.length === 0 && remainingBudget > 0) {
      planned.push({
        cardmarketId: cmid,
        isFoil,
        condition: cond,
        qtyIn: remainingBudget,
        qtyRemaining: remainingBudget,
        avgUnitCostEur: null,
        sourceCode: 'BACKFILL',
        sourceDate: new Date('2000-01-01'),
        location: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  if (dry) {
    return new Response(JSON.stringify({ ok: true, dry: true, planned: planned.length }), { headers: { "Content-Type": "application/json" } });
  }

  // insert in batches
  while (planned.length) {
    const chunk = planned.splice(0, 1000);
    await prisma.inventoryLot.createMany({ data: chunk });
  }

  return new Response(JSON.stringify({ ok: true, inserted: true }), { headers: { "Content-Type": "application/json" } });
}
