import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseSourceDate(input: string | null | undefined): Date | null {
  const s = (input ?? "").trim();
  if (!s) return null;

  // YYYY-MM-DD
  const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (mIso) {
    const y = Number(mIso[1]);
    const mo = Number(mIso[2]);
    const d = Number(mIso[3]);
    return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  }

  // DD-MM-YYYY
  const mEu = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mEu) {
    const d = Number(mEu[1]);
    const mo = Number(mEu[2]);
    const y = Number(mEu[3]);
    return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  }

  return null; // ❌ geen gokken meer
}


type StockInRow = {
  cardmarketId: number;
  isFoil: boolean;
  condition: string;
  qty: number;
  unitCostEur: number;
  sourceCode?: string | null;
  sourceDate?: string | null;
  language?: string | null;   
};

// heel simpele CSV parser: split op newline + comma/semicolon
function parseCsv(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines.length) return [];

  const sep = lines[0].includes(";") ? ";" : ",";

  return lines.map((line) => line.split(sep).map((p) => p.trim()));
}

// taal normaliseren uit CSV
function normalizeLanguageFromCsv(raw: string | null | undefined): string {
  const s = (raw ?? "").toString().trim().toUpperCase();
  if (!s) return "EN";

  if (["EN", "ENG", "ENGLISH"].includes(s)) return "EN";
  if (["JA", "JP", "JPN", "JAPANESE"].includes(s)) return "JA";
  if (["DE", "GER", "GERMAN"].includes(s)) return "DE";

  // Onbekend maar wel ingevuld? Laat gewoon zo staan (uppercase).
  return s;
}

export async function POST(req: NextRequest) {
  try {
    // Geen extra auth hier – admin UI/middleware beschermt dit al
    const body = await req.json();
    const csvText: string = body.csv;
    const defaultSourceCode: string | null = body.defaultSourceCode ?? null;
    const defaultSourceDate: string | null = body.defaultSourceDate ?? null;

    if (!csvText || typeof csvText !== "string") {
      return NextResponse.json(
        { ok: false, error: "missing csv text" },
        { status: 400 }
      );
    }

    const rows = parseCsv(csvText);
    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "empty csv" },
        { status: 400 }
      );
    }

    const header = rows[0].map((h) => h.toLowerCase());
    const dataRows = rows.slice(1);

    function idx(name: string) {
      const i = header.indexOf(name.toLowerCase());
      return i >= 0 ? i : -1;
    }

    const idxCardmarketId = idx("cardmarketid");
    const idxIsFoil = idx("isfoil");
    const idxCondition = idx("condition");
    const idxQty = idx("qty");
    const idxUnitCost = idx("unitcosteur");
    const idxSourceCode = idx("sourcecode");
    const idxSourceDate = idx("sourcedate");
    const idxLanguage = idx("language");      

   const required: Array<{ name: string; idx: number }> = [
  { name: "cardmarketId", idx: idxCardmarketId },
  { name: "isFoil", idx: idxIsFoil },
  { name: "condition", idx: idxCondition },
  { name: "qty", idx: idxQty },
  { name: "unitCostEur", idx: idxUnitCost },
];

const missingRequired = required
  .filter((r) => r.idx < 0)
  .map((r) => r.name);

    if (missingRequired.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `missing required columns: ${missingRequired.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const parsed: StockInRow[] = [];
    const errors: { line: number; message: string }[] = [];

    dataRows.forEach((cols, rowIdx) => {
      const lineNumber = rowIdx + 2; // 1-based + header

      const cmRaw = cols[idxCardmarketId];
      const foilRaw = cols[idxIsFoil];
      const condRaw = cols[idxCondition];
      const qtyRaw = cols[idxQty];
      const costRaw = cols[idxUnitCost];
      const langRaw = idxLanguage >= 0 ? cols[idxLanguage] : null;

      const cmid = Number(cmRaw);
      const qty = Number(qtyRaw);
      // vervang komma door punt, zodat 3,42 → 3.42 wordt
      const unitCost = Number((costRaw || "").replace(",", "."));

      const isFoil =
        foilRaw?.toLowerCase() === "true" ||
        foilRaw === "1" ||
        foilRaw?.toLowerCase() === "foil";

      const condition = (condRaw || "").toUpperCase().trim();
      const language = normalizeLanguageFromCsv(langRaw);  // ✅

      if (!Number.isInteger(cmid) || cmid <= 0) {
        errors.push({ line: lineNumber, message: `invalid cardmarketId: ${cmRaw}` });
        return;
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        errors.push({ line: lineNumber, message: `invalid qty: ${qtyRaw}` });
        return;
      }
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        errors.push({ line: lineNumber, message: `invalid unitCostEur: ${costRaw}` });
        return;
      }
      if (!condition) {
        errors.push({ line: lineNumber, message: `missing condition` });
        return;
      }

      const sourceCode =
        (idxSourceCode >= 0 ? cols[idxSourceCode] : "") ||
        defaultSourceCode ||
        "UNKNOWN";

      const sourceDateStr =
        (idxSourceDate >= 0 ? cols[idxSourceDate] : "") ||
        defaultSourceDate ||
        null;

      parsed.push({
        cardmarketId: cmid,
        isFoil,
        condition,
        qty,
        unitCostEur: unitCost,
        sourceCode,
        sourceDate: sourceDateStr,
        language,           // ✅
      });
    });

    if (!parsed.length) {
      return NextResponse.json(
        { ok: false, error: "no valid rows", errors },
        { status: 400 }
      );
    }

    // --- naar DB: lots + balances ---
    let lotsCreated = 0;
    let balancesUpserted = 0;

    for (const row of parsed) {
   const parsedDate = parseSourceDate(row.sourceDate);
const when = parsedDate ?? new Date(); // fallback = nu


      const language = row.language || "EN"; // safety

      // 1) Lot aanmaken
      await prisma.inventoryLot.create({
        data: {
          cardmarketId: row.cardmarketId,
          isFoil: row.isFoil,
          condition: row.condition,
          language,                // ✅
          qtyIn: row.qty,
          qtyRemaining: row.qty,
          avgUnitCostEur: row.unitCostEur,
          sourceCode: row.sourceCode ?? "UNKNOWN",
          sourceDate: when,
        },
      });
      lotsCreated++;

      // 2) Balance upsert + gewogen gemiddelde cost
      const existing = await prisma.inventoryBalance.findFirst({
        where: {
          cardmarketId: row.cardmarketId,
          isFoil: row.isFoil,
          condition: row.condition,
          language,                // ✅ zelfde taal
        },
      });

      if (existing) {
        const oldQty = Number(existing.qtyOnHand ?? 0);
        const oldCost =
          existing.avgUnitCostEur == null ? 0 : Number(existing.avgUnitCostEur);
        const newQty = oldQty + row.qty;

        const newAvg =
          newQty > 0
            ? (oldQty * oldCost + row.qty * row.unitCostEur) / newQty
            : row.unitCostEur;

        await prisma.inventoryBalance.update({
          where: { id: existing.id },
          data: {
            qtyOnHand: { increment: row.qty },
            avgUnitCostEur: newAvg,
          },
        });
      } else {
        await prisma.inventoryBalance.create({
          data: {
            cardmarketId: row.cardmarketId,
            isFoil: row.isFoil,
            condition: row.condition,
            language,             // ✅
            qtyOnHand: row.qty,
            avgUnitCostEur: row.unitCostEur,
          },
        });
      }

      balancesUpserted++;
    }

    return NextResponse.json({
      ok: true,
      rowsParsed: parsed.length,
      lotsCreated,
      balancesUpserted,
      rowErrors: errors,
    });
  } catch (e: any) {
    console.error("stock-in upload error", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
