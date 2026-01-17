// src/app/api/admin/stock-in/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma, StockClass as PrismaStockClass } from "@prisma/client";





export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * StockClass simplificatie (SYP-based):
 * - Als card tcgplayerId in SypDemand zit met maxQty >= 10 => sypHot => REGULAR
 * - Anders => CTBULK
 * - StockPolicy (REGULAR/CTBULK) kan altijd overrulen
 * - We vullen lade C ook met normale kaarten (compact)
 */

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

  return null; // ❌ geen gokken
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

// simpele CSV parser: split op newline + comma/semicolon
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

const ROW_CAPACITY = 900;

// fysieke ranges (we vullen C ook)
const DRAWER_PRIORITY_REGULAR = ["D", "E", "F", "A", "B", "G", "H", "I", "J"] as const;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseLoc(loc: string | null | undefined): { drawer: string; row: number; batch: number } | null {
  const s = (loc ?? "").trim();
  const m = s.match(/^([A-J])(\d{2})\.(\d{2})$/);
  if (!m) return null;
  return { drawer: m[1], row: Number(m[2]), batch: Number(m[3]) };
}

function rowKey(drawer: string, row: number) {
  return `${drawer}${pad2(row)}`; // e.g. A04
}

type StockClass = "REGULAR" | "CTBULK";

function allowedRowsForClass(_stockClass: StockClass) {
  // C eerst (compact), daarna rest
  const DRAWER_PRIORITY = ["C", ...DRAWER_PRIORITY_REGULAR] as const;
  return DRAWER_PRIORITY.map((d) => ({ drawer: d, rows: [1, 2, 3, 4, 5, 6] }));
}

async function getStockClassByCardmarketId(cardmarketId: number) {
  const lookup = await prisma.scryfallLookup.findUnique({
    where: { cardmarketId },
    select: { scryfallId: true, tcgplayerId: true },
  });

  // NIET gokken → als we niets weten: REGULAR
  if (!lookup?.scryfallId) {
    return { stockClass: "REGULAR" as const, warning: "missing_scryfall_lookup" as const };
  }

  // 1) SYP hot? (maxQty >= 10)
  let sypHot = false;
  if (lookup.tcgplayerId != null) {
    const row = await prisma.sypDemand.findFirst({
      where: { tcgProductId: lookup.tcgplayerId },
      select: { maxQty: true },
    });
    sypHot = (row?.maxQty ?? 0) >= 10;
  }

  // 2) StockPolicy override (alleen REGULAR/CTBULK gebruiken)
  const pol = await prisma.stockPolicy.findUnique({
    where: { scryfallId: lookup.scryfallId },
    select: { stockClass: true, sypHot: true },
  });

  if (pol?.stockClass === "REGULAR" || pol?.stockClass === "CTBULK") {
    // update sypHot flag mee (handig voor UI/exports)
    if (pol.sypHot !== sypHot) {
      await prisma.stockPolicy.update({
        where: { scryfallId: lookup.scryfallId },
        data: { sypHot },
      });
    }
    return { stockClass: pol.stockClass as StockClass, warning: null as any };
  }

  // 3) Default: SYP hot => REGULAR, anders CTBULK
  const stockClass: PrismaStockClass =
  sypHot ? PrismaStockClass.REGULAR : PrismaStockClass.CTBULK;






  // policy upsert zodat exports/worklist simpel blijven
  await prisma.stockPolicy.upsert({
    where: { scryfallId: lookup.scryfallId },
    create: { scryfallId: lookup.scryfallId, stockClass: stockClass as any, sypHot },
    update: { stockClass: stockClass as any, sypHot },
  });

  return { stockClass, warning: null as any };
}

/**
 * Source-aware allocator:
 * - Prefer rows that already contain the same sourceCode
 * - Else prefer completely empty rows
 * - Else fallback to least-mixed, then least-used
 */
type AllocState = {
  startByGroup: Map<string, { drawer: string; row: number }>;
  reservedByRow: Map<string, number>;
  batchByRowAndSource: Map<string, number>;
  maxBatchByRow: Map<string, number>;
  usedByRow: Map<string, number>;
  sourcesByRow: Map<string, Set<string>>;
};

async function buildAllocState(): Promise<AllocState> {
  const lots = await prisma.inventoryLot.findMany({
    where: { location: { not: null }, qtyRemaining: { gt: 0 } },
    select: { location: true, qtyRemaining: true, sourceCode: true },
  });

  const usedByRow = new Map<string, number>();
  const batchByRowAndSource = new Map<string, number>();
  const maxBatchByRow = new Map<string, number>();
  const sourcesByRow = new Map<string, Set<string>>();

  for (const l of lots) {
    const p = parseLoc(l.location);
    if (!p) continue;

    const rk = rowKey(p.drawer, p.row);
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

  return {
    startByGroup: new Map(),
    reservedByRow: new Map(),
    batchByRowAndSource,
    maxBatchByRow,
    usedByRow,
    sourcesByRow,
  };
}

function getUsedWithReserve(state: AllocState, rk: string) {
  return (state.usedByRow.get(rk) ?? 0) + (state.reservedByRow.get(rk) ?? 0);
}

function reserve(state: AllocState, rk: string, qty: number) {
  state.reservedByRow.set(rk, (state.reservedByRow.get(rk) ?? 0) + qty);
}

function canFit(state: AllocState, rk: string, qty: number) {
  return getUsedWithReserve(state, rk) + qty <= ROW_CAPACITY;
}

function pickCandidate(state: AllocState, candidates: Array<{ drawer: string; row: number }>, qty: number) {
  for (const c of candidates) {
    const rk = rowKey(c.drawer, c.row);
    if (!canFit(state, rk, qty)) continue;
    return c;
  }
  return null;
}

async function allocateLocationForRow(
  state: AllocState,
  opts: { stockClass: StockClass; sourceCode: string; qty: number }
): Promise<string | null> {
  const groups = allowedRowsForClass(opts.stockClass);
  const groupKey = `${opts.stockClass}|${opts.sourceCode}`;

  function batchFor(rk: string) {
    const sourceKey = `${rk}|${opts.sourceCode}`;
    const existingBatch = state.batchByRowAndSource.get(sourceKey);
    const batch = existingBatch ?? Math.min(99, (state.maxBatchByRow.get(rk) ?? 0) + 1);
    if (batch < 1 || batch > 99) return null;

    state.batchByRowAndSource.set(sourceKey, batch);
    state.maxBatchByRow.set(rk, Math.max(state.maxBatchByRow.get(rk) ?? 0, batch));
    return batch;
  }

  const allCandidates: Array<{ drawer: string; row: number }> = [];
  for (const g of groups) for (const r of g.rows) allCandidates.push({ drawer: g.drawer, row: r });

  // 1) prefer same source already in row
  const sourceCandidates = allCandidates.filter((c) => {
    const rk = rowKey(c.drawer, c.row);
    return state.sourcesByRow.get(rk)?.has(opts.sourceCode) ?? false;
  });

  let chosen = pickCandidate(state, sourceCandidates, opts.qty);

  // 2) else empty rows
  if (!chosen) {
    const emptyCandidates = allCandidates.filter((c) => {
      const rk = rowKey(c.drawer, c.row);
      const used = getUsedWithReserve(state, rk);
      const sources = state.sourcesByRow.get(rk);
      return used === 0 && (!sources || sources.size === 0);
    });
    chosen = pickCandidate(state, emptyCandidates, opts.qty);
  }

  // 3) else least mixed then least used
  if (!chosen) {
    const ranked = [...allCandidates].sort((a, b) => {
      const rka = rowKey(a.drawer, a.row);
      const rkb = rowKey(b.drawer, b.row);
      const mixA = state.sourcesByRow.get(rka)?.size ?? 0;
      const mixB = state.sourcesByRow.get(rkb)?.size ?? 0;
      if (mixA !== mixB) return mixA - mixB;
      return getUsedWithReserve(state, rka) - getUsedWithReserve(state, rkb);
    });
    chosen = pickCandidate(state, ranked, opts.qty);
  }

  if (!chosen) return null;

  state.startByGroup.set(groupKey, { drawer: chosen.drawer, row: chosen.row });

  const rk = rowKey(chosen.drawer, chosen.row);
  const batch = batchFor(rk);
  if (batch == null) return null;

  reserve(state, rk, opts.qty);

  const set = state.sourcesByRow.get(rk) ?? new Set<string>();
  set.add(opts.sourceCode);
  state.sourcesByRow.set(rk, set);

  return `${chosen.drawer}${pad2(chosen.row)}.${pad2(batch)}`;
}

/**
 * Consolidatie binnen dezelfde upload
 */
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
      return NextResponse.json({ ok: false, error: "no valid rows", errors }, { status: 400 });
    }

    const consolidated = consolidateRows(parsed);

    // bulk lookup for picklist
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

      const location = await allocateLocationForRow(allocState, {
        stockClass: sc.stockClass,
        sourceCode,
        qty: row.qty,
      });

      if (!location) {
        errors.push({
          line: 0,
          message: `no location capacity available for ${sc.stockClass} (cardmarketId ${row.cardmarketId})`,
        });
        continue;
      }

      await prisma.inventoryLot.create({
        data: {
          cardmarketId: row.cardmarketId,
          isFoil: row.isFoil,
          condition: row.condition,
          language,
          qtyIn: row.qty,
          qtyRemaining: row.qty,
          avgUnitCostEur: row.unitCostEur,
          sourceCode,
          sourceDate: when,
          location,
        },
      });
      lotsCreated++;

      const lu = lookupByCmid.get(row.cardmarketId);
      picklist.push({
        location,
        set: lu?.set ?? "",
        name: lu?.name ?? "",
        collectorNumber: lu?.collectorNumber ?? null,
        condition: row.condition,
        language,
        isFoil: row.isFoil,
        qty: row.qty,
        cardmarketId: row.cardmarketId,
        sourceCode,
        sourceDate: when.toISOString(),
        unitCostEur: row.unitCostEur,
      });

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
          newQty > 0 ? (oldQty * oldCost + row.qty * row.unitCostEur) / newQty : row.unitCostEur;

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
