// src/app/api/admin/stock-in/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { StockClass as PrismaStockClass } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROW_CAPACITY = 900;

type StockClass = "REGULAR" | "CTBULK";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

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

  return null; // geen gokken
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

type PickRow = {
  location: string;
  set: string;
  name: string;
  collectorNumber: string | null;
  condition: string;
  language: string;
  isFoil: boolean;
  qty: number;
  cardmarketId: number;
  sourceCode: string;
  sourceDate: string; // ISO
  unitCostEur: number;
};

function parseCsv(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines.length) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  return lines.map((line) => line.split(sep).map((p) => p.trim()));
}

function normalizeLanguageFromCsv(raw: string | null | undefined): string {
  const s = (raw ?? "").toString().trim().toUpperCase();
  if (!s) return "EN";
  if (["EN", "ENG", "ENGLISH"].includes(s)) return "EN";
  if (["JA", "JP", "JPN", "JAPANESE"].includes(s)) return "JA";
  if (["DE", "GER", "GERMAN"].includes(s)) return "DE";
  return s;
}

function parseLoc(loc: string | null | undefined): { kind: "MAIN" | "CTBULK"; drawer: string; row: number; batch: number } | null {
  const s = (loc ?? "").trim();

  // CTBULK: CB-A01.01
  let m = s.match(/^CB-([A-H])(\d{2})\.(\d{2})$/i);
  if (m) return { kind: "CTBULK", drawer: m[1].toUpperCase(), row: Number(m[2]), batch: Number(m[3]) };

  // MAIN: A01.01
  m = s.match(/^([A-J])(\d{2})\.(\d{2})$/i);
  if (m) return { kind: "MAIN", drawer: m[1].toUpperCase(), row: Number(m[2]), batch: Number(m[3]) };

  return null;
}

function rowKey(kind: "MAIN" | "CTBULK", drawer: string, row: number) {
  return `${kind}|${drawer}${pad2(row)}`; // MAIN|A01
}

function formatLoc(kind: "MAIN" | "CTBULK", drawer: string, row: number, batch: number) {
  const base = `${drawer}${pad2(row)}.${pad2(batch)}`;
  return kind === "CTBULK" ? `CB-${base}` : base;
}

type RowCandidate = { kind: "MAIN" | "CTBULK"; drawer: string; row: number };


function allowedRowsForClass(stockClass: StockClass): RowCandidate[] {
  if (stockClass === "CTBULK") {
    const drawers = ["A","B","C","D","E","F","G","H"];
    return drawers.flatMap((d) => [1,2,3,4].map((r) => ({ kind: "CTBULK", drawer: d, row: r })));
  }
  const drawers = ["A","B","C","D","E","F","G","H","I","J"];
  return drawers.flatMap((d) => [1,2,3,4,5,6].map((r) => ({ kind: "MAIN", drawer: d, row: r })));
}


/**
 * Stockclass bepalen:
 * - via ScryfallLookup -> StockPolicy override
 * - anders SYP hot (maxQty>=10) => REGULAR, else CTBULK
 * - als lookup ontbreekt => REGULAR (geen gokken)
 */
async function getStockClassByCardmarketId(cardmarketId: number) {
  const lookup = await prisma.scryfallLookup.findUnique({
    where: { cardmarketId },
    select: { scryfallId: true, tcgplayerId: true },
  });

  if (!lookup?.scryfallId) {
    return { stockClass: "REGULAR" as const, warning: "missing_scryfall_lookup" as const };
  }

  let sypHot = false;
  if (lookup.tcgplayerId != null) {
    const row = await prisma.sypDemand.findFirst({
      where: { tcgProductId: lookup.tcgplayerId },
      select: { maxQty: true },
    });
    sypHot = (row?.maxQty ?? 0) >= 10;
  }

  const pol = await prisma.stockPolicy.findUnique({
    where: { scryfallId: lookup.scryfallId },
    select: { stockClass: true, sypHot: true },
  });

  if (pol?.stockClass === "REGULAR" || pol?.stockClass === "CTBULK") {
    if (pol.sypHot !== sypHot) {
      await prisma.stockPolicy.update({
        where: { scryfallId: lookup.scryfallId },
        data: { sypHot },
      });
    }
    return { stockClass: pol.stockClass as StockClass, warning: null as any };
  }

  const stockClass: PrismaStockClass = sypHot ? PrismaStockClass.REGULAR : PrismaStockClass.CTBULK;

  await prisma.stockPolicy.upsert({
    where: { scryfallId: lookup.scryfallId },
    create: { scryfallId: lookup.scryfallId, stockClass: stockClass as any, sypHot },
    update: { stockClass: stockClass as any, sypHot },
  });

  return { stockClass: stockClass as any as StockClass, warning: null as any };
}

/**
 * Alloc state:
 * - usedByRow: hoeveel kaarten (qtyRemaining) al in die rij liggen
 * - maxBatchByRow: hoogste batchnummer in die rij
 * - batchByRowAndSource: batchnummer dat al voor deze source in die rij gebruikt wordt (zodat "source blok" stabiel blijft)
 * - sourcesByRow: welke sources komen al voor in die rij (mix-score)
 * - reservedByRow: reservering binnen deze upload (zodat we niet over 900 heen plannen)
 */
type AllocState = {
  usedByRow: Map<string, number>;
  maxBatchByRow: Map<string, number>;
  batchByRowAndSource: Map<string, number>;
  sourcesByRow: Map<string, Set<string>>;
  reservedByRow: Map<string, number>;
};

async function buildAllocState(): Promise<AllocState> {
  const lots = await prisma.inventoryLot.findMany({
    where: { qtyRemaining: { gt: 0 }, location: { not: null } },
    select: { location: true, qtyRemaining: true, sourceCode: true },
  });

  const usedByRow = new Map<string, number>();
  const maxBatchByRow = new Map<string, number>();
  const batchByRowAndSource = new Map<string, number>();
  const sourcesByRow = new Map<string, Set<string>>();

  for (const l of lots) {
    const p = parseLoc(l.location);
    if (!p) continue;

    const rk = rowKey(p.kind, p.drawer, p.row);
    usedByRow.set(rk, (usedByRow.get(rk) ?? 0) + Number(l.qtyRemaining ?? 0));
    maxBatchByRow.set(rk, Math.max(maxBatchByRow.get(rk) ?? 0, p.batch));

    const sc = (l.sourceCode ?? "").trim();
    if (sc) {
      const set = sourcesByRow.get(rk) ?? new Set<string>();
      set.add(sc);
      sourcesByRow.set(rk, set);

      const key = `${rk}|${sc}`;
      const existing = batchByRowAndSource.get(key);
      if (existing == null || p.batch < existing) batchByRowAndSource.set(key, p.batch);
    }
  }

  return { usedByRow, maxBatchByRow, batchByRowAndSource, sourcesByRow, reservedByRow: new Map() };
}

function usedWithReserve(state: AllocState, rk: string) {
  return (state.usedByRow.get(rk) ?? 0) + (state.reservedByRow.get(rk) ?? 0);
}
function remainingCap(state: AllocState, rk: string) {
  return Math.max(0, ROW_CAPACITY - usedWithReserve(state, rk));
}
function reserve(state: AllocState, rk: string, qty: number) {
  state.reservedByRow.set(rk, (state.reservedByRow.get(rk) ?? 0) + qty);
}

function batchFor(state: AllocState, rk: string, sourceCode: string) {
  const key = `${rk}|${sourceCode}`;
  const existing = state.batchByRowAndSource.get(key);
  if (existing != null) return existing;

  const next = Math.min(99, (state.maxBatchByRow.get(rk) ?? 0) + 1);
  if (next < 1 || next > 99) return null;

  state.batchByRowAndSource.set(key, next);
  state.maxBatchByRow.set(rk, Math.max(state.maxBatchByRow.get(rk) ?? 0, next));

  const srcSet = state.sourcesByRow.get(rk) ?? new Set<string>();
  srcSet.add(sourceCode);
  state.sourcesByRow.set(rk, srcSet);

  return next;
}

function pickBestRow(
  state: AllocState,
  stockClass: StockClass,
  sourceCode: string,
  neededQty: number
): RowCandidate | null {
  const candidates: RowCandidate[] = allowedRowsForClass(stockClass);


  // 1) rows waar dezelfde source al ligt
  const sameSource = candidates.filter((c) => {
    const rk = rowKey(c.kind, c.drawer, c.row);
    return state.sourcesByRow.get(rk)?.has(sourceCode) ?? false;
  });

  const fits = (arr: RowCandidate[]) =>

    arr
      .map((c) => {
        const rk = rowKey(c.kind, c.drawer, c.row);
        return { c, rem: remainingCap(state, rk), used: usedWithReserve(state, rk), mix: state.sourcesByRow.get(rk)?.size ?? 0 };
      })
      .filter((x) => x.rem > 0);

  // helper: kies beste kandidaat, liefst eentje waar alles past
  function choose(arr: RowCandidate[]) {

    const xs = fits(arr);
    if (!xs.length) return null;

    const full = xs.filter((x) => x.rem >= neededQty);
    if (full.length) {
      // packing: meest gevuld die nog past
      full.sort((a, b) => b.used - a.used);
      return full[0].c;
    }

    // anders: minst splits => meeste ruimte
    xs.sort((a, b) => b.rem - a.rem);
    return xs[0].c;
  }

  let chosen = choose(sameSource);
  if (chosen) return chosen;

  // 2) lege rows (used=0 en geen sources)
  const empty = candidates.filter((c) => {
    const rk = rowKey(c.kind, c.drawer, c.row);
    const u = usedWithReserve(state, rk);
    const mix = state.sourcesByRow.get(rk)?.size ?? 0;
    return u === 0 && mix === 0;
  });
  chosen = choose(empty);
  if (chosen) return chosen;

  // 3) minst gemixt, dan minst gevuld, dan meest remaining
  const ranked = [...candidates]
    .map((c) => {
      const rk = rowKey(c.kind, c.drawer, c.row);
      const mix = state.sourcesByRow.get(rk)?.size ?? 0;
      const u = usedWithReserve(state, rk);
      const rem = remainingCap(state, rk);
      return { c, mix, u, rem };
    })
    .filter((x) => x.rem > 0)
    .sort((a, b) => {
      if (a.mix !== b.mix) return a.mix - b.mix;
      if (a.u !== b.u) return a.u - b.u;
      return b.rem - a.rem;
    });

  return ranked[0]?.c ?? null;
}

/**
 * Allocate qty over 1+ rows, but keep "source block" stable:
 * location is per (row, sourceCode) via batchFor().
 */
function allocateForQty(
  state: AllocState,
  stockClass: StockClass,
  sourceCode: string,
  totalQty: number
): Array<{ location: string; qty: number }> {
  let remaining = totalQty;
  const out: Array<{ location: string; qty: number }> = [];

  while (remaining > 0) {
    const row = pickBestRow(state, stockClass, sourceCode, remaining);
    if (!row) break;

    const rk = rowKey(row.kind, row.drawer, row.row);
    const cap = remainingCap(state, rk);
    if (cap <= 0) break;

    const take = Math.min(remaining, cap);
    const batch = batchFor(state, rk, sourceCode);
    if (batch == null) break;

    reserve(state, rk, take);
    out.push({ location: formatLoc(row.kind, row.drawer, row.row, batch), qty: take });

    remaining -= take;
  }

  return out;
}

function consolidateRows(rows: StockInRow[]) {
  type Key = string;
  const map = new Map<Key, StockInRow>();

  for (const r of rows) {
    const key = [
      r.cardmarketId,
      r.isFoil ? 1 : 0,
      (r.condition || "").toUpperCase(),
      (r.language || "EN").toUpperCase(),
      (r.sourceCode || "UNKNOWN").trim(),
      (r.sourceDate || "").trim(),
    ].join("|");

    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r });
      continue;
    }

    const newQty = prev.qty + r.qty;
    const prevTot = prev.qty * prev.unitCostEur;
    const addTot = r.qty * r.unitCostEur;
    const newAvg = newQty > 0 ? (prevTot + addTot) / newQty : prev.unitCostEur;

    map.set(key, { ...prev, qty: newQty, unitCostEur: newAvg });
  }

  return Array.from(map.values());
}

export async function POST(req: NextRequest) {
  try {
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
        foilRaw?.toLowerCase() === "true" || foilRaw === "1" || foilRaw?.toLowerCase() === "foil";

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
      return NextResponse.json({ ok: false, error: "no valid rows", rowErrors: errors }, { status: 400 });
    }

    const consolidated = consolidateRows(parsed);

    // lookup for picklist sorting
    const uniqueIds = Array.from(new Set(consolidated.map((r) => r.cardmarketId)));
    const lookupRows = await prisma.scryfallLookup.findMany({
      where: { cardmarketId: { in: uniqueIds } },
      select: { cardmarketId: true, name: true, set: true, collectorNumber: true },
    });
    const lookupByCmid = new Map<number, { name: string; set: string; collectorNumber: string | null }>();
    for (const l of lookupRows) {
      lookupByCmid.set(Number(l.cardmarketId), {
        name: l.name,
        set: l.set,
        collectorNumber: l.collectorNumber ?? null,
      });
    }

    const allocState = await buildAllocState();

    let lotsCreated = 0;
    let balancesUpserted = 0;

    const warnings: string[] = [];
    const picklist: PickRow[] = [];
    const classCounts: Record<string, number> = { REGULAR: 0, CTBULK: 0 };

    for (const row of consolidated) {
      const parsedDate = parseSourceDate(row.sourceDate);
      const when = parsedDate ?? new Date();
      const language = row.language || "EN";
      const sourceCode = (row.sourceCode ?? "UNKNOWN").trim() || "UNKNOWN";

      const sc = await getStockClassByCardmarketId(row.cardmarketId);
      if (sc.warning) warnings.push(`${sc.warning}:${row.cardmarketId}`);
      classCounts[String(sc.stockClass)] = (classCounts[String(sc.stockClass)] ?? 0) + 1;

      // ✅ source-block allocator (splits only when >900)
      const allocs = allocateForQty(allocState, sc.stockClass, sourceCode, row.qty);
      const allocatedTotal = allocs.reduce((a, x) => a + x.qty, 0);

      if (allocatedTotal !== row.qty) {
        errors.push({
          line: 0,
          message: `no location capacity available for ${sc.stockClass} (cardmarketId ${row.cardmarketId}) need=${row.qty} allocated=${allocatedTotal}`,
        });
        continue;
      }

      const lu = lookupByCmid.get(row.cardmarketId);

      for (const a of allocs) {
        await prisma.inventoryLot.create({
          data: {
            cardmarketId: row.cardmarketId,
            isFoil: row.isFoil,
            condition: row.condition,
            language,
            qtyIn: a.qty,
            qtyRemaining: a.qty,
            avgUnitCostEur: row.unitCostEur,
            sourceCode,
            sourceDate: when,
            location: a.location,
          },
        });
        lotsCreated++;

        picklist.push({
          location: a.location,
          set: lu?.set ?? "",
          name: lu?.name ?? "",
          collectorNumber: lu?.collectorNumber ?? null,
          condition: row.condition,
          language,
          isFoil: row.isFoil,
          qty: a.qty,
          cardmarketId: row.cardmarketId,
          sourceCode,
          sourceDate: when.toISOString(),
          unitCostEur: row.unitCostEur,
        });
      }

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
        const newAvg = newQty > 0 ? (oldQty * oldCost + row.qty * row.unitCostEur) / newQty : row.unitCostEur;

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

    picklist.sort((a, b) => {
      const lc = a.location.localeCompare(b.location);
      if (lc !== 0) return lc;
      const sc = (a.set || "").localeCompare(b.set || "");
      if (sc !== 0) return sc;
      const nc = (a.name || "").localeCompare(b.name || "");
      if (nc !== 0) return nc;
      return (a.condition || "").localeCompare(b.condition || "");
    });

    return NextResponse.json({
      ok: true,
      rowsParsed: parsed.length,
      rowsConsolidated: consolidated.length,
      lotsCreated,
      balancesUpserted,
      stockClassCounts: classCounts,
      rowErrors: errors,
      warnings,
      picklist,
    });
  } catch (e: any) {
    console.error("stock-in upload error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
