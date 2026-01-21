import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROW_CAPACITY = 900;

type StockClass = "REGULAR" | "CTBULK";
type Kind = "MAIN" | "CTBULK";

type RowRef = { kind: Kind; drawer: string; row: number };

function pad2(n: number) { return String(n).padStart(2, "0"); }

function allowedRowsForClass(stockClass: StockClass): RowRef[] {
  if (stockClass === "CTBULK") {
    const drawers = ["A","B","C","D","E","F","G","H"];
    return drawers.flatMap(d => [1,2,3,4].map(r => ({ kind: "CTBULK" as const, drawer: d, row: r })));
  }
  const drawers = ["A","B","C","D","E","F","G","H","I","J"];
  return drawers.flatMap(d => [1,2,3,4,5,6].map(r => ({ kind: "MAIN" as const, drawer: d, row: r })));
}

function rowKey(kind: Kind, drawer: string, row: number) {
  return `${kind}|${drawer}${pad2(row)}`; // MAIN|A01
}

function formatLoc(kind: Kind, drawer: string, row: number, seg: number) {
  const base = `${drawer}${pad2(row)}.${pad2(seg)}`; // ✅ segment = source-blok index
  return kind === "CTBULK" ? `CB-${base}` : base;
}

function csvEscape(s: any) {
  const v = (s ?? "").toString();
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

type EnrichedLot = {
  id: string;
  cardmarketId: number;
  isFoil: boolean;
  condition: string;
  language: string;
  qtyRemaining: number;
  sourceCode: string;
  sourceDate: Date;
  oldLocation: string | null;

  stockClass: StockClass;

  set: string;
  name: string;
};

type PlanRow = {
  lotId: string;
  oldLocation: string | null;
  newLocation: string;
  stockClass: StockClass;
  qty: number;

  sourceCode: string;
  sourceDate: string;

  set: string;
  name: string;
  condition: string;
  language: string;
  isFoil: boolean;
};

type AllocState = {
  usedByRow: Map<string, number>;        // rowKey -> used cards
  segByRow: Map<string, number>;         // rowKey -> max segment used (per row)
  cursorByClass: Map<StockClass, number>; // which row index we are filling now
};

function used(state: AllocState, rk: string) { return state.usedByRow.get(rk) ?? 0; }
function remaining(state: AllocState, rk: string) { return Math.max(0, ROW_CAPACITY - used(state, rk)); }
function nextSeg(state: AllocState, rk: string) {
  const seg = (state.segByRow.get(rk) ?? 0) + 1;
  if (seg < 1 || seg > 99) return null;
  state.segByRow.set(rk, seg);
  return seg;
}

export async function GET(req: NextRequest) {
  // auth
  if (process.env.NODE_ENV === "production") {
    const token = req.headers.get("x-admin-token");
    if (!token || token !== process.env.ADMIN_TOKEN) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase(); // csv|json

  // 1) lots
  const lots = await prisma.inventoryLot.findMany({
    where: { qtyRemaining: { gt: 0 } },
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
  });

  // 2) lookup -> scryfallId/set/name
  const cmids = Array.from(new Set(lots.map(l => l.cardmarketId)));
  const lookups = await prisma.scryfallLookup.findMany({
    where: { cardmarketId: { in: cmids } },
    select: { cardmarketId: true, scryfallId: true, set: true, name: true },
  });

  const luByCmid = new Map<number, { scryfallId: string; set: string; name: string }>();
  for (const l of lookups) luByCmid.set(l.cardmarketId, { scryfallId: l.scryfallId, set: l.set, name: l.name });

  // 3) policies -> stockClass
  const scryIds = Array.from(new Set(lookups.map(l => l.scryfallId)));
  const policies = await prisma.stockPolicy.findMany({
    where: { scryfallId: { in: scryIds } },
    select: { scryfallId: true, stockClass: true },
  });

  const polBySid = new Map<string, StockClass>();
  for (const p of policies) polBySid.set(p.scryfallId, p.stockClass === "CTBULK" ? "CTBULK" : "REGULAR");

  // 4) enrich
  const enriched: EnrichedLot[] = lots.map(l => {
    const lu = luByCmid.get(l.cardmarketId);
    const stockClass: StockClass = lu?.scryfallId ? (polBySid.get(lu.scryfallId) ?? "REGULAR") : "REGULAR";

    return {
      id: l.id,
      cardmarketId: l.cardmarketId,
      isFoil: l.isFoil,
      condition: l.condition,
      language: l.language,
      qtyRemaining: Number(l.qtyRemaining ?? 0),
      sourceCode: l.sourceCode,
      sourceDate: l.sourceDate,
      oldLocation: l.location ?? null,
      stockClass,
      set: lu?.set ?? "",
      name: lu?.name ?? "",
    };
  });

  // 5) sort: EERST stockClass, dan sourceDate+sourceCode, dan set/name/cond (zoals jij wil)
  enriched.sort((a, b) => {
    if (a.stockClass !== b.stockClass) return a.stockClass.localeCompare(b.stockClass);

    const sd = a.sourceDate.getTime() - b.sourceDate.getTime();
    if (sd !== 0) return sd;

    const sc = (a.sourceCode || "").localeCompare(b.sourceCode || "");
    if (sc !== 0) return sc;

    const setc = (a.set || "").localeCompare(b.set || "");
    if (setc !== 0) return setc;

    const namec = (a.name || "").localeCompare(b.name || "");
    if (namec !== 0) return namec;

    const condc = (a.condition || "").localeCompare(b.condition || "");
    if (condc !== 0) return condc;

    const langc = (a.language || "").localeCompare(b.language || "");
    if (langc !== 0) return langc;

    return Number(a.isFoil) - Number(b.isFoil);
  });

  // 6) group into SOURCE blocks (per stockClass + sourceDate + sourceCode)
  type Block = {
    stockClass: StockClass;
    sourceCode: string;
    sourceDate: Date;
    lots: EnrichedLot[];
    qtyTotal: number;
  };

  const blocks: Block[] = [];
  const keyOf = (x: EnrichedLot) =>
    `${x.stockClass}|${x.sourceCode}|${x.sourceDate.toISOString().slice(0,10)}`;

  let cur: Block | null = null;
  for (const l of enriched) {
    const k = keyOf(l);
    if (!cur || keyOf(cur.lots[0]) !== k) {
      cur = { stockClass: l.stockClass, sourceCode: l.sourceCode, sourceDate: l.sourceDate, lots: [], qtyTotal: 0 };
      blocks.push(cur);
    }
    cur.lots.push(l);
    cur.qtyTotal += l.qtyRemaining;
  }

  // 7) allocate blocks sequentially:
  // - within each row, each new block gets a new seg (.01, .02, ...)
  // - if a block doesn't fit, spill to next row (and there .01 again)
  const state: AllocState = {
    usedByRow: new Map(),
    segByRow: new Map(),
    cursorByClass: new Map([["REGULAR", 0], ["CTBULK", 0]]),
  };

  const plan: PlanRow[] = [];

  function currentRowFor(stockClass: StockClass): RowRef | null {
    const rows = allowedRowsForClass(stockClass);
    let idx = state.cursorByClass.get(stockClass) ?? 0;
    while (idx < rows.length) {
      const r = rows[idx];
      const rk = rowKey(r.kind, r.drawer, r.row);
      if (remaining(state, rk) > 0) {
        state.cursorByClass.set(stockClass, idx);
        return r;
      }
      idx++;
      state.cursorByClass.set(stockClass, idx);
    }
    return null;
  }

  function advanceRow(stockClass: StockClass) {
    const idx = (state.cursorByClass.get(stockClass) ?? 0) + 1;
    state.cursorByClass.set(stockClass, idx);
  }

  // allocate one block across rows; returns list of placements {row, seg, qtyTake}
  function placeBlock(block: Block) {
    const placements: Array<{ row: RowRef; seg: number; qty: number }> = [];
    let left = block.qtyTotal;

    while (left > 0) {
      const row = currentRowFor(block.stockClass);
      if (!row) return null;

      const rk = rowKey(row.kind, row.drawer, row.row);
      const rem = remaining(state, rk);
      if (rem <= 0) { advanceRow(block.stockClass); continue; }

      // new segment for this block in this row
      const seg = nextSeg(state, rk);
      if (seg == null) return null;

      const take = Math.min(left, rem);

      state.usedByRow.set(rk, used(state, rk) + take);

      placements.push({ row, seg, qty: take });
      left -= take;

      // if row filled, next placement goes next row
      if (used(state, rk) >= ROW_CAPACITY) {
        advanceRow(block.stockClass);
      }
    }

    return placements;
  }

  for (const block of blocks) {
    const placements = placeBlock(block);
    if (!placements) {
      return NextResponse.json({
        ok: false,
        error: "capacity exceeded",
        stockClass: block.stockClass,
        sourceCode: block.sourceCode,
        sourceDate: block.sourceDate.toISOString(),
        need: block.qtyTotal,
      }, { status: 400 });
    }

    // Now assign locations to the lots inside this block, in order.
    // We fill lot-by-lot into placement qty buckets.
    let placementIdx = 0;
    let bucketLeft = placements[0]?.qty ?? 0;

    for (const lot of block.lots) {
      let lotLeft = lot.qtyRemaining;

      while (lotLeft > 0) {
        const p = placements[placementIdx];
        if (!p) {
          return NextResponse.json({ ok: false, error: "internal allocation mismatch" }, { status: 500 });
        }

        const take = Math.min(lotLeft, bucketLeft);

        plan.push({
          lotId: lot.id,
          oldLocation: lot.oldLocation,
          newLocation: formatLoc(p.row.kind, p.row.drawer, p.row.row, p.seg),
          stockClass: block.stockClass,
          qty: take,
          sourceCode: block.sourceCode,
          sourceDate: block.sourceDate.toISOString(),
          set: lot.set,
          name: lot.name,
          condition: lot.condition,
          language: lot.language,
          isFoil: lot.isFoil,
        });

        lotLeft -= take;
        bucketLeft -= take;

        if (bucketLeft <= 0) {
          placementIdx++;
          bucketLeft = placements[placementIdx]?.qty ?? 0;
        }
      }
    }
  }

  if (format === "json") {
    return NextResponse.json({ ok: true, count: plan.length, plan });
  }

  const header = [
    "lotId","oldLocation","newLocation","stockClass","qty",
    "sourceCode","sourceDate","set","name","condition","language","isFoil"
  ];
  const lines = [header.join(",")];

  for (const r of plan) {
    lines.push([
      csvEscape(r.lotId),
      csvEscape(r.oldLocation ?? ""),
      csvEscape(r.newLocation),
      csvEscape(r.stockClass),
      csvEscape(r.qty),
      csvEscape(r.sourceCode),
      csvEscape(r.sourceDate),
      csvEscape(r.set),
      csvEscape(r.name),
      csvEscape(r.condition),
      csvEscape(r.language),
      csvEscape(r.isFoil ? "1" : "0"),
    ].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
