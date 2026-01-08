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

// ----------------- LOCATION ALLOCATOR -----------------

const ROW_CAPACITY = 900;
const DRAWER_PRIORITY_REGULAR = ["D", "E", "F", "A", "B", "G", "H", "I", "J"] as const;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseLoc(
  loc: string | null | undefined
): { drawer: string; row: number; batch: number } | null {
  const s = (loc ?? "").trim();
  const m = s.match(/^([A-J])(\d{2})\.(\d{2})$/);
  if (!m) return null;
  return { drawer: m[1], row: Number(m[2]), batch: Number(m[3]) };
}

function rowKey(drawer: string, row: number) {
  return `${drawer}${pad2(row)}`; // e.g. C01
}

async function getStockClassByCardmarketId(cardmarketId: number) {
  const lookup = await prisma.scryfallLookup.findUnique({
    where: { cardmarketId },
    select: { scryfallId: true },
  });

  if (!lookup?.scryfallId) {
    // expliciet gedrag: zonder lookup -> REGULAR
    return { stockClass: "REGULAR" as const, warning: "missing_scryfall_lookup" as const };
  }

  const pol = await prisma.stockPolicy.findUnique({
    where: { scryfallId: lookup.scryfallId },
    select: { stockClass: true },
  });

  // jouw regel: geen policy => REGULAR
  return { stockClass: (pol?.stockClass ?? "REGULAR") as any, warning: null as any };
}

function allowedRowsForClass(stockClass: "CORE" | "COMMANDER" | "REGULAR" | "CTBULK") {
  if (stockClass === "CORE") {
    return [{ drawer: "C", rows: [1, 2] }];
  }
  if (stockClass === "COMMANDER") {
    return [{ drawer: "C", rows: [3, 4, 5, 6] }];
  }
  // REGULAR + CTBULK
  return DRAWER_PRIORITY_REGULAR.map((d) => ({ drawer: d, rows: [1, 2, 3, 4, 5, 6] }));
}

/**
 * Allocate a *start* location (single loc string) but verify the incomingQty can
 * fit contiguously across subsequent allowed rows (row+1, row+2, ...) if needed.
 *
 * We still store only one location on the lot; overflow is "understood".
 */
async function allocateLocation(opts: {
  stockClass: "CORE" | "COMMANDER" | "REGULAR" | "CTBULK";
  sourceCode: string;
  incomingQty: number;
}) {
  const groups = allowedRowsForClass(opts.stockClass);

  // Load all existing lots with location (global load)
  const lots = await prisma.inventoryLot.findMany({
    where: {
      location: { not: null },
      qtyRemaining: { gt: 0 },
    },
    select: { location: true, qtyRemaining: true, sourceCode: true },
  });

  // used per rowKey
  const usedByRow = new Map<string, number>();
  // batch per (rowKey|sourceCode) (reuse if exists)
  const batchByRowAndSource = new Map<string, number>();
  // max batch per rowKey
  const maxBatchByRow = new Map<string, number>();

  for (const l of lots) {
    const p = parseLoc(l.location);
    if (!p) continue;

    const rk = rowKey(p.drawer, p.row);
    usedByRow.set(rk, (usedByRow.get(rk) ?? 0) + Number(l.qtyRemaining ?? 0));
    maxBatchByRow.set(rk, Math.max(maxBatchByRow.get(rk) ?? 0, p.batch));

    if ((l.sourceCode ?? "") === opts.sourceCode) {
      const key = `${rk}|${opts.sourceCode}`;
      const existing = batchByRowAndSource.get(key);
      if (existing == null || p.batch < existing) batchByRowAndSource.set(key, p.batch);
    }
  }

  // Helper: does qty fit from a start row across contiguous rows within the same group?
  function fitsContiguously(drawer: string, rows: number[], startIndex: number, qty: number) {
    let remaining = qty;

    for (let i = startIndex; i < rows.length; i++) {
      const r = rows[i];
      const rk = rowKey(drawer, r);
      const used = usedByRow.get(rk) ?? 0;
      const free = Math.max(0, ROW_CAPACITY - used);

      if (free <= 0) continue;

      remaining -= free;
      if (remaining <= 0) return true;
    }

    return false;
  }

  // Find first start row where it fits
  for (const g of groups) {
    const rows = g.rows;

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const rk = rowKey(g.drawer, r);
      const used = usedByRow.get(rk) ?? 0;

      if (used >= ROW_CAPACITY) continue;

      // must fit across this row and subsequent rows (same allowed range)
      if (!fitsContiguously(g.drawer, rows, idx, opts.incomingQty)) continue;

      // Batch: reuse if same source already exists in *start row*, else next batch
      const sourceKey = `${rk}|${opts.sourceCode}`;
      const existingBatch = batchByRowAndSource.get(sourceKey);
      const batch = existingBatch ?? Math.min(99, (maxBatchByRow.get(rk) ?? 0) + 1);

      if (batch < 1 || batch > 99) continue;

      return `${g.drawer}${pad2(r)}.${pad2(batch)}`; // e.g. C01.03
    }
  }

  return null; // not enough contiguous space
}

// ----------------- ROUTE -----------------

export async function POST(req: NextRequest) {
  try {
    // Geen extra auth hier – admin UI/middleware beschermt dit al
    const body = await req.json();
    const csvText: string = body.csv;
    const defaultSourceCode: string | null = body.defaultSourceCode ?? null;
    const defaultSourceDate: string | null = body.defaultSourceDate ?? null;

    if (!csvText || typeof csvText !== "string") {
      return NextResponse.json({ ok: false, error: "missing csv text" }, { status: 400 });
    }

    const rows = parseCsv(csvText);
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "empty csv" }, { status: 400 });
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

    const missingRequired = required.filter((r) => r.idx < 0).map((r) => r.name);
    if (missingRequired.length) {
      return NextResponse.json(
        { ok: false, error: `missing required columns: ${missingRequired.join(", ")}` },
        { status: 400 }
      );
    }

    const parsed: StockInRow[] = [];
    const errors: { line: number; message: string }[] = [];

    dataRows.forEach((cols, rowIdx) => {
      const lineNumber = rowIdx + 2;

      const cmRaw = cols[idxCardmarketId];
      const foilRaw = cols[idxIsFoil];
      const condRaw = cols[idxCondition];
      const qtyRaw = cols[idxQty];
      const costRaw = cols[idxUnitCost];
      const langRaw = idxLanguage >= 0 ? cols[idxLanguage] : null;

      const cmid = Number(cmRaw);
      const qty = Number(qtyRaw);
      const unitCost = Number((costRaw || "").replace(",", "."));

      const isFoil =
        foilRaw?.toLowerCase() === "true" ||
        foilRaw === "1" ||
        foilRaw?.toLowerCase() === "foil";

      const condition = (condRaw || "").toUpperCase().trim();
      const language = normalizeLanguageFromCsv(langRaw);

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
        (idxSourceCode >= 0 ? cols[idxSourceCode] : "") || defaultSourceCode || "UNKNOWN";

      const sourceDateStr =
        (idxSourceDate >= 0 ? cols[idxSourceDate] : "") || defaultSourceDate || null;

      parsed.push({
        cardmarketId: cmid,
        isFoil,
        condition,
        qty,
        unitCostEur: unitCost,
        sourceCode,
        sourceDate: sourceDateStr,
        language,
      });
    });

    if (!parsed.length) {
      return NextResponse.json({ ok: false, error: "no valid rows", errors }, { status: 400 });
    }

    let lotsCreated = 0;
    let balancesUpserted = 0;
    const warnings: { line: number; message: string }[] = [];

    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i];
      const lineNumber = i + 2; // best-effort (parsed volgt input order)

      const parsedDate = parseSourceDate(row.sourceDate);
      const when = parsedDate ?? new Date(); // fallback = nu (zoals jij had)

      const language = row.language || "EN";

      // stockClass + location (contiguous fit)
      const sc = await getStockClassByCardmarketId(row.cardmarketId);
      if (sc.warning === "missing_scryfall_lookup") {
        warnings.push({ line: lineNumber, message: `missing ScryfallLookup for cardmarketId=${row.cardmarketId} (treated as REGULAR)` });
      }

      const location = await allocateLocation({
        stockClass: sc.stockClass,
        sourceCode: row.sourceCode ?? "UNKNOWN",
        incomingQty: row.qty,
      });

      if (!location) {
        errors.push({
          line: lineNumber,
          message: `no contiguous location capacity available for ${sc.stockClass} qty=${row.qty}`,
        });
        continue;
      }

      // 1) Lot aanmaken (één location)
      await prisma.inventoryLot.create({
        data: {
          cardmarketId: row.cardmarketId,
          isFoil: row.isFoil,
          condition: row.condition,
          language,
          qtyIn: row.qty,
          qtyRemaining: row.qty,
          avgUnitCostEur: row.unitCostEur,
          sourceCode: row.sourceCode ?? "UNKNOWN",
          sourceDate: when,
          location,
        },
      });
      lotsCreated++;

      // 2) Balance upsert + gewogen gemiddelde cost
      const existing = await prisma.inventoryBalance.findFirst({
        where: {
          cardmarketId: row.cardmarketId,
          isFoil: row.isFoil,
          condition: row.condition,
          language,
        },
      });

      if (existing) {
        const oldQty = Number(existing.qtyOnHand ?? 0);
        const oldCost = existing.avgUnitCostEur == null ? 0 : Number(existing.avgUnitCostEur);
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
            language,
            qtyOnHand: row.qty,
            avgUnitCostEur: row.unitCostEur,
          },
        });
      }

      balancesUpserted++;
    }

    return NextResponse.json({
      ok: errors.length === 0,
      rowsParsed: parsed.length,
      lotsCreated,
      balancesUpserted,
      rowErrors: errors,
      warnings,
    });
  } catch (e: any) {
    console.error("stock-in upload error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
