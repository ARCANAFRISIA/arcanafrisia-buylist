// src/app/api/stock/in/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parse } from "csv-parse/sync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Typing helpers
type SnapshotRow = {
  cardmarketId: string | number;
  isFoil: string | boolean;
  condition: string;
  qtyOnHand?: string | number;
  avgUnitCostEur?: string | number;
  language?: string | null;
};

type LotRow = {
  cardmarketId: string | number;
  isFoil: string | boolean;
  condition: string;
  qty?: string | number;
  avgUnitCostEur?: string | number;
  location?: string;
  sourceCode?: string;
  sourceDate?: string;
};

function toBool(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "y" || s === "yes";
}

export async function POST(req: NextRequest) {
  try {
    const mode = (req.nextUrl.searchParams.get("mode") || "lots").toLowerCase(); // "snapshot" | "lots"
    const csv = await req.text();

    // Parse CSV -> rows as array of records (string:string)
    const rows = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "CSV bevat geen rijen" }, { status: 400 });
    }

    if (mode === "snapshot") {
      // Expected columns: cardmarketId,isFoil,condition,qtyOnHand,avgUnitCostEur
      let updated = 0;
      for (const r of rows as SnapshotRow[]) {
        const key = {
          cardmarketId: Number((r as any).cardmarketId),
          isFoil: toBool((r as any).isFoil),
          condition: String((r as any).condition || "").toUpperCase(),
          language: String((r as any).language || "EN").toUpperCase(),
        };
        if (!Number.isFinite(key.cardmarketId) || !key.condition) continue;

        const qty = Number((r as any).qtyOnHand ?? 0);
        const avg = (r as any).avgUnitCostEur;

        await prisma.inventoryBalance.upsert({
          where: { cardmarketId_isFoil_condition_language: key },

          create: {
            ...key,
            qtyOnHand: Number.isFinite(qty) ? qty : 0,
            avgUnitCostEur: avg != null && String(avg).length ? String(avg) : null,
          },
          update: {
            qtyOnHand: Number.isFinite(qty) ? qty : 0,
            ...(avg != null && String(avg).length ? { avgUnitCostEur: String(avg) } : {}),
          },
        });
        updated++;
      }
      return NextResponse.json({ ok: true, mode, rows: rows.length, updated });
    }

    // mode === "lots"
    // Expected columns: cardmarketId,isFoil,condition,qty,avgUnitCostEur,location,sourceCode,sourceDate
    let createdLots = 0;
    for (const r of rows as LotRow[]) {
      const cardmarketId = Number((r as any).cardmarketId);
      const isFoil = toBool((r as any).isFoil);
      const condition = String((r as any).condition || "").toUpperCase();
      const language = String((r as any).language || "EN").toUpperCase();
      const qty = Number((r as any).qty ?? 0);
      const avg = (r as any).avgUnitCostEur;
      const location = (r as any).location || null;
      const sourceCode = (r as any).sourceCode || "IMPORT";
      const sourceDate = (r as any).sourceDate ? new Date((r as any).sourceDate) : new Date();

      if (!Number.isFinite(cardmarketId) || !condition) continue;

      const lot = await prisma.inventoryLot.create({
        data: {
          cardmarketId,
          isFoil,
          condition,
          qtyIn: Number.isFinite(qty) ? qty : 0,
          qtyRemaining: Number.isFinite(qty) ? qty : 0,
          avgUnitCostEur: avg != null && String(avg).length ? String(avg) : "0",
          location,
          sourceCode,
          sourceDate,
        },
      });

      await prisma.inventoryTxn.create({
        data: {
          kind: "LOT_IN",
          ts: new Date(),
          cardmarketId,
          isFoil,
          condition,
          qty: Number.isFinite(qty) ? qty : 0,
          unitCostEur: avg != null && String(avg).length ? String(avg) : null,
          refSource: sourceCode,
          refExternalId: lot.id,
        },
      });

      await prisma.inventoryBalance.upsert({
  where: {
    cardmarketId_isFoil_condition_language: {
      cardmarketId,
      isFoil,
      condition,
      language,
    },
  },
  create: {
    cardmarketId,
    isFoil,
    condition,
    language,
    qtyOnHand: Number.isFinite(qty) ? qty : 0,
    avgUnitCostEur:
      avg != null && String(avg).length ? String(avg) : null,
  },
  update: {
    qtyOnHand: Number.isFinite(qty) ? qty : 0,
    ...(avg != null && String(avg).length
      ? { avgUnitCostEur: String(avg) }
      : {}),
  },
});


      createdLots++;
    }

    return NextResponse.json({ ok: true, mode, rows: rows.length, createdLots });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
