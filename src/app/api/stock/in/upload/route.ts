// src/app/api/stock/in/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parse } from "csv-parse/sync";

export const POST = async (req: NextRequest) => {
  const mode = (req.nextUrl.searchParams.get("mode") || "lots").toLowerCase(); // "snapshot"|"lots"
  const csv = await req.text();
  const rows = parse(csv, { columns: true, skip_empty_lines: true });

  if (mode === "snapshot") {
    // CSV kolommen: cardmarketId,isFoil,condition,qtyOnHand,avgUnitCostEur
    for (const r of rows) {
      const key = {
        cardmarketId: Number(r.cardmarketId),
        isFoil: String(r.isFoil).toLowerCase() === "true",
        condition: String(r.condition).toUpperCase(),
      };
      const qty = Number(r.qtyOnHand) || 0;
      await prisma.inventoryBalance.upsert({
        where: { cardmarketId_isFoil_condition: key },
        create: { ...key, qtyOnHand: qty, avgUnitCostEur: r.avgUnitCostEur ? r.avgUnitCostEur : null },
        update: { qtyOnHand: qty, avgUnitCostEur: r.avgUnitCostEur ? r.avgUnitCostEur : undefined },
      });
    }
    return NextResponse.json({ ok: true, mode, rows: rows.length });
  }

  // mode === "lots"
  // CSV kolommen: cardmarketId,isFoil,condition,qty,avgUnitCostEur,location,sourceCode,sourceDate
  for (const r of rows) {
    const lot = await prisma.inventoryLot.create({
      data: {
        cardmarketId: Number(r.cardmarketId),
        isFoil: String(r.isFoil).toLowerCase() === "true",
        condition: String(r.condition).toUpperCase(),
        qtyIn: Number(r.qty) || 0,
        qtyRemaining: Number(r.qty) || 0,
        avgUnitCostEur: r.avgUnitCostEur ?? "0",
        location: r.location || null,
        sourceCode: r.sourceCode || "IMPORT",
        sourceDate: r.sourceDate ? new Date(r.sourceDate) : new Date(),
      },
    });
    await prisma.inventoryTxn.create({
      data: {
        kind: "LOT_IN",
        cardmarketId: lot.cardmarketId,
        isFoil: lot.isFoil,
        condition: lot.condition,
        qty: lot.qtyIn,
        unitCostEur: lot.avgUnitCostEur,
        refSource: lot.sourceCode,
        refExternalId: lot.id,
      },
    });
    // balance bijwerken
    await prisma.inventoryBalance.upsert({
      where: { cardmarketId_isFoil_condition: {
        cardmarketId: lot.cardmarketId, isFoil: lot.isFoil, condition: lot.condition
      }},
      create: {
        cardmarketId: lot.cardmarketId, isFoil: lot.isFoil, condition: lot.condition,
        qtyOnHand: lot.qtyIn, avgUnitCostEur: lot.avgUnitCostEur
      },
      update: {
        qtyOnHand: { increment: lot.qtyIn },
        // kostprijs laten staan (we kunnen later een rolling average doen)
      }
    });
  }
  return NextResponse.json({ ok: true, mode, rows: rows.length });
};
