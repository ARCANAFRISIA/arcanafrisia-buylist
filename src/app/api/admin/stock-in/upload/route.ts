// src/app/api/admin/stock-in/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROW_CAPACITY = 900;

type CtStockClass = "CTBULK";
type RouteTarget = "PM_CORE" | "PM_PLAYED" | "CTBULK";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseSourceDate(input: string | null | undefined): Date | null {
  const s = (input ?? "").trim();
  if (!s) return null;

  const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (mIso) {
    const y = Number(mIso[1]);
    const mo = Number(mIso[2]);
    const d = Number(mIso[3]);
    return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  }

  const mEu = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mEu) {
    const d = Number(mEu[1]);
    const mo = Number(mEu[2]);
    const y = Number(mEu[3]);
    return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  }

  return null;
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
  sourceDate: string;
  unitCostEur: number;
  routeTarget: RouteTarget;
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

function normalizeCondition(raw: string | null | undefined): string {
  return (raw ?? "").toString().trim().toUpperCase();
}

function isPmCoreCondition(condition: string): boolean {
  const c = normalizeCondition(condition);
  return c === "EX" || c === "GD";
}

function parseLoc(
  loc: string | null | undefined
): { kind: "MAIN" | "CTBULK"; drawer: string; row: number; batch: number } | null {
  const s = (loc ?? "").trim();

  let m = s.match(/^CB-([A-H])(\d{2})\.(\d{2})$/i);
  if (m) return { kind: "CTBULK", drawer: m[1].toUpperCase(), row: Number(m[2]), batch: Number(m[3]) };

  m = s.match(/^([A-J])(\d{2})\.(\d{2})$/i);
  if (m) return { kind: "MAIN", drawer: m[1].toUpperCase(), row: Number(m[2]), batch: Number(m[3]) };

  return null;
}

function rowKey(kind: "MAIN" | "CTBULK", drawer: string, row: number) {
  return `${kind}|${drawer}${pad2(row)}`;
}

function formatLoc(kind: "MAIN" | "CTBULK", drawer: string, row: number, batch: number) {
  const base = `${drawer}${pad2(row)}.${pad2(batch)}`;
  return kind === "CTBULK" ? `CB-${base}` : base;
}

type RowCandidate = { kind: "CTBULK"; drawer: string; row: number };

function allowedRowsForClass(stockClass: CtStockClass): RowCandidate[] {
  if (stockClass === "CTBULK") {
    const drawers = ["A", "B", "C", "D", "E", "F", "G", "H"];
    return drawers.flatMap((d) => [1, 2, 3, 4].map((r) => ({ kind: "CTBULK" as const, drawer: d, row: r })));
  }
  return [];
}

/**
 * Premodern set codes
 * - normal PM range
 * - plus WC97..WC02
 * - explicitly no 3ED
 */
const PREMODERN_SET_CODES = new Set<string>([
  "4ed",
  "ice",
  "chr",
  "hml",
  "all",
  "mir",
  "vis",
  "5ed",
  "wth",
  "tmp",
  "sth",
  "exo",
  "usg",
  "ulg",
  "6ed",
  "uds",
  "mmq",
  "nem",
  "pcy",
  "inv",
  "pls",
  "7ed",
  "apc",
  "ody",
  "tor",
  "jud",
  "ons",
  "lgn",
  "scg",
  "wc98",
  "wcd13",
  "wcd14",
  "wcd15",
  "wcd16",
  "wc99",
  "wc00",
  "wc01",
  "wc02",
]);

function isPremodernSet(setCode: string | null | undefined): boolean {
  const s = (setCode ?? "").trim().toLowerCase();
  return !!s && PREMODERN_SET_CODES.has(s);
}

function toPmCoreLocation(setCode: string | null | undefined, condition: string): string | null {
  const s = (setCode ?? "").trim().toUpperCase();
  const c = normalizeCondition(condition);
  if (!s) return null;
  if (!isPmCoreCondition(c)) return null;
  return `PM-${s}-${c}`;
}

function decideRoute(setCode: string | null | undefined, condition: string): {
  routeTarget: RouteTarget;
  fixedLocation?: string;
  ctClass?: CtStockClass;
  warning?: string | null;
} {
  const setNormalized = (setCode ?? "").trim().toLowerCase();
  const cond = normalizeCondition(condition);

  if (!setNormalized) {
    return {
      routeTarget: "CTBULK",
      ctClass: "CTBULK",
      warning: "missing_set_lookup",
    };
  }

  if (!isPremodernSet(setNormalized)) {
    return {
      routeTarget: "CTBULK",
      ctClass: "CTBULK",
      warning: null,
    };
  }

  if (isPmCoreCondition(cond)) {
    const loc = toPmCoreLocation(setNormalized, cond);
    if (!loc) {
      return {
        routeTarget: "CTBULK",
        ctClass: "CTBULK",
        warning: "invalid_pm_core_location",
      };
    }

    return {
      routeTarget: "PM_CORE",
      fixedLocation: loc,
      warning: null,
    };
  }

  return {
    routeTarget: "PM_PLAYED",
    fixedLocation: "PM-PLAYED",
    warning: null,
  };
}

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
    if (p.kind !== "CTBULK") continue;

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
  stockClass: CtStockClass,
  sourceCode: string,
  neededQty: number
): RowCandidate | null {
  const candidates: RowCandidate[] = allowedRowsForClass(stockClass);

  const sameSource = candidates.filter((c) => {
    const rk = rowKey(c.kind, c.drawer, c.row);
    return state.sourcesByRow.get(rk)?.has(sourceCode) ?? false;
  });

  const fits = (arr: RowCandidate[]) =>
    arr
      .map((c) => {
        const rk = rowKey(c.kind, c.drawer, c.row);
        return {
          c,
          rem: remainingCap(state, rk),
          used: usedWithReserve(state, rk),
          mix: state.sourcesByRow.get(rk)?.size ?? 0,
        };
      })
      .filter((x) => x.rem > 0);

  function choose(arr: RowCandidate[]) {
    const xs = fits(arr);
    if (!xs.length) return null;

    const full = xs.filter((x) => x.rem >= neededQty);
    if (full.length) {
      full.sort((a, b) => b.used - a.used);
      return full[0].c;
    }

    xs.sort((a, b) => b.rem - a.rem);
    return xs[0].c;
  }

  let chosen = choose(sameSource);
  if (chosen) return chosen;

  const empty = candidates.filter((c) => {
    const rk = rowKey(c.kind, c.drawer, c.row);
    const u = usedWithReserve(state, rk);
    const mix = state.sourcesByRow.get(rk)?.size ?? 0;
    return u === 0 && mix === 0;
  });
  chosen = choose(empty);
  if (chosen) return chosen;

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

function allocateForQty(
  state: AllocState,
  stockClass: CtStockClass,
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
      normalizeCondition(r.condition),
      (r.language || "EN").toUpperCase(),
      (r.sourceCode || "UNKNOWN").trim(),
      (r.sourceDate || "").trim(),
    ].join("|");

    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r, condition: normalizeCondition(r.condition) });
      continue;
    }

    const newQty = prev.qty + r.qty;
    const prevTot = prev.qty * prev.unitCostEur;
    const addTot = r.qty * r.unitCostEur;
    const newAvg = newQty > 0 ? (prevTot + addTot) / newQty : prev.unitCostEur;

    map.set(key, {
      ...prev,
      condition: normalizeCondition(prev.condition),
      qty: newQty,
      unitCostEur: newAvg,
    });
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

      const condition = normalizeCondition(condRaw);
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
    const routeCounts: Record<RouteTarget, number> = {
      PM_CORE: 0,
      PM_PLAYED: 0,
      CTBULK: 0,
    };

    for (const row of consolidated) {
      const parsedDate = parseSourceDate(row.sourceDate);
      const when = parsedDate ?? new Date();
      const language = row.language || "EN";
      const sourceCode = (row.sourceCode ?? "UNKNOWN").trim() || "UNKNOWN";

      const lu = lookupByCmid.get(row.cardmarketId);
      const decision = decideRoute(lu?.set ?? null, row.condition);

      if (decision.warning) warnings.push(`${decision.warning}:${row.cardmarketId}`);
      routeCounts[decision.routeTarget] = (routeCounts[decision.routeTarget] ?? 0) + 1;

      let allocs: Array<{ location: string; qty: number }> = [];

      if (decision.fixedLocation) {
        allocs = [{ location: decision.fixedLocation, qty: row.qty }];
      } else if (decision.ctClass) {
        allocs = allocateForQty(allocState, decision.ctClass, sourceCode, row.qty);
      }

      const allocatedTotal = allocs.reduce((a, x) => a + x.qty, 0);

      if (allocatedTotal !== row.qty) {
        errors.push({
          line: 0,
          message: `no location capacity available for ${decision.routeTarget} (cardmarketId ${row.cardmarketId}) need=${row.qty} allocated=${allocatedTotal}`,
        });
        continue;
      }

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
          routeTarget: decision.routeTarget,
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
      routeCounts,
      rowErrors: errors,
      warnings,
      picklist,
    });
  } catch (e: any) {
    console.error("stock-in upload error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}