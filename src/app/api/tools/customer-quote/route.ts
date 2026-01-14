export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computeUnitFromTrend, CondKey } from "@/lib/buylistEngineCore";
import { getPendingQtyByCardmarketId } from "@/lib/buylistPending";
import fs from "fs";
import path from "path";

// -------------------- Normalization --------------------
function normText(s: string): string {
  return (s ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNameForMatching(raw: string): string {
  let s = (raw ?? "").trim();

  // Split/adventure/etc: "A // B" -> "A"
  s = s.split("//")[0].trim();

  // Remove "(Showcase)", "(Borderless)" etc
  s = s.replace(/\([^)]*\)/g, " ");

  // Remove "[...]" tags
  s = s.replace(/\[[^\]]*\]/g, " ");

  // Normalize whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function normCollector(v: any): string {
  if (v == null) return "";
  const s = String(v).trim();
  const left = s.split("/")[0]?.trim() ?? s;
  return left.replace(/[^0-9a-zA-Z]+/g, "");
}

function normalizeSetForMapping(raw: string): string {
  let s = (raw ?? "").trim();

  // Strip common prefixes in exports
  s = s.replace(/^universes beyond:\s*/i, "");
  s = s.replace(/^commander:\s*/i, "");

  // Normalize punctuation
  s = s.replace(/[–—]/g, "-");
  s = s.replace(/:/g, " "); // we'll also try right-side later
  s = s.replace(/\s+/g, " ").trim();

  // Common suffix noise
  s = s.replace(/\s+drop series$/i, " drop");

  return s;
}

// Keep this SMALL and safe. Add more based on remaining not_found.
const SET_ALIASES: Record<string, string> = {
  "double masters 2022": "2x2",
  "double masters": "2xm",

  "the lord of the rings tales of middle earth": "ltr",
  "warhammer 40 000": "40k",

  "secret lair drop": "sld",
  "30th anniversary countdown kit": "slc",

  "the list": "plst",

  "the brothers war retro frame artifacts": "brr",
  "multiverse legends": "mul",

  "modern horizons 2": "mh2",
  "commander 2020": "c20",
  "commander 2021": "c21",
};

// -------------------- CSV helpers --------------------
function parseSemicolonCsv(text: string): Record<string, string>[] {
  const lines = (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length);

  if (!lines.length) return [];
  const header = lines[0].split(";").map((h) => h.trim());
  const out: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = (cols[c] ?? "").trim();
    out.push(row);
  }
  return out;
}

function loadSetMap(): Map<string, string> {
  const p = path.join(process.cwd(), "src", "data", "setmap_from_all_sets.csv");
  const raw = fs.readFileSync(p, "utf8");
  const rows = parseSemicolonCsv(raw);

  const m = new Map<string, string>();
  for (const r of rows) {
    const full = r["fullSetName"] ?? r["FullSetName"] ?? r["setName"] ?? "";
    const code = r["setCode"] ?? r["setcode"] ?? "";
    if (!full || !code) continue;
    m.set(normText(full), code.trim().toLowerCase());
  }
  return m;
}

// -------------------- types --------------------
type CustomerRow = {
  name: string;
  setFull: string;
  collectorNumber: string;
  isFoil: boolean;
  qty: number;
};

type ParsedLine = CustomerRow & {
  nameNorm: string;
  setCode: string | null;
  key: string;
};

// -------------------- main --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const csvText: string = body?.csvText ?? "";
    const defaultCond: CondKey = (body?.defaultCond ?? "NM") as CondKey;

    if (!csvText || typeof csvText !== "string") {
      return NextResponse.json({ ok: false, error: "csvText required" }, { status: 400 });
    }

    // 1) Parse customer CSV
    const rows = parseSemicolonCsv(csvText);

    const customer: CustomerRow[] = rows
      .map((r) => {
        const nameRaw = r["Name"] ?? r["name"] ?? "";
        const setFull = r["Set"] ?? r["set"] ?? "";
        const cn = r["Card Number"] ?? r["CardNumber"] ?? r["collectorNumber"] ?? "";
        const foilRaw = (r["Foil"] ?? r["foil"] ?? "").trim().toLowerCase();
        const qtyRaw = r["Quantity"] ?? r["qty"] ?? "0";

        const isFoil =
          foilRaw === "foil" || foilRaw === "1" || foilRaw === "true" || foilRaw === "t";

        const qty = Number(qtyRaw);

        return {
          name: normalizeNameForMatching(String(nameRaw)),
          setFull: String(setFull).trim(),
          collectorNumber: normCollector(cn),
          isFoil,
          qty: Number.isFinite(qty) ? Math.max(0, Math.trunc(qty)) : 0,
        };
      })
      .filter((r) => r.name && r.setFull && r.qty > 0);

    // 2) Aggregate duplicates and map sets
    const setMap = loadSetMap();
    const agg = new Map<string, ParsedLine>();

    for (const r of customer) {
      const nameNorm = normText(r.name);

      // set mapping: try full, then right side of ":" (if present), then aliases
      const rawSet = r.setFull;
      const cleaned = normalizeSetForMapping(rawSet);
      const k1 = normText(cleaned);

      let k2: string | null = null;
      if (rawSet.includes(":")) {
        const right = rawSet.split(":").slice(1).join(":").trim();
        if (right) k2 = normText(normalizeSetForMapping(right));
      }

      let setCode =
        setMap.get(k1) ?? SET_ALIASES[k1] ?? null;

      if (!setCode && k2) {
        setCode = setMap.get(k2) ?? SET_ALIASES[k2] ?? null;
      }

      const key = [
        nameNorm,
        setCode ?? "",
        r.collectorNumber ?? "",
        r.isFoil ? "foil" : "nonfoil",
      ].join("|");

      const existing = agg.get(key);
      if (existing) existing.qty += r.qty;
      else agg.set(key, { ...r, nameNorm, setCode, key });
    }

    const lines = Array.from(agg.values());

    // 3) Not found due to set mapping
    const withSet = lines.filter((l) => !!l.setCode);
    const noSet = lines.filter((l) => !l.setCode);

    const notFound: any[] = noSet.map((l) => ({
      status: "NOT FOUND",
      reason: "SET_NOT_MAPPED",
      name: l.name,
      setFull: l.setFull,
      setCode: null,
      collectorNumber: l.collectorNumber,
      isFoil: l.isFoil,
      qty: l.qty,
    }));

    // 4) Resolve cardmarketId via ScryfallLookup
    // Strategy:
    //  - if collectorNumber exists -> resolve by (set + collectorNumber) (robust)
    //  - else -> resolve by (set + name equals insensitive)
    const CHUNK = 200;

    const bySetCn = new Map<string, number>();   // "set|cn" -> cmId
    const byNameSet = new Map<string, number>(); // "nameNorm|set" -> cmId

    const keySetCn = (set: string, cn: string) => `${set.toLowerCase()}|${normCollector(cn)}`;
    const keyNameSet = (name: string, set: string) =>
      `${normText(normalizeNameForMatching(name))}|${set.toLowerCase()}`;

    const need = withSet.map((l) => ({
      name: l.name,
      set: l.setCode!, // lowercase
      collectorNumber: l.collectorNumber || "",
    }));

    for (let i = 0; i < need.length; i += CHUNK) {
      const part = need.slice(i, i + CHUNK);

      const orClauses: any[] = part.map((p) => {
        if (p.collectorNumber) {
          return { set: p.set, collectorNumber: p.collectorNumber };
        }
        return { set: p.set, name: { equals: p.name, mode: "insensitive" } };
      });

      const hits = await prisma.scryfallLookup.findMany({
        where: { OR: orClauses },
        select: { cardmarketId: true, name: true, set: true, collectorNumber: true },
      });

      for (const h of hits) {
        if (!h.cardmarketId) continue;
        const set = (h.set ?? "").toLowerCase();
        const cn = normCollector(h.collectorNumber ?? "");
        const nameKey = keyNameSet(h.name ?? "", set);

        if (cn) {
          const k = keySetCn(set, cn);
          if (!bySetCn.has(k)) bySetCn.set(k, h.cardmarketId);
        }
        if (!byNameSet.has(nameKey)) byNameSet.set(nameKey, h.cardmarketId);
      }
    }

    const resolved = withSet.map((l) => {
      const cmId =
        (l.collectorNumber ? bySetCn.get(keySetCn(l.setCode!, l.collectorNumber)) : null) ??
        byNameSet.get(keyNameSet(l.name, l.setCode!)) ??
        null;
      return { line: l, cardmarketId: cmId };
    });

    for (const r of resolved) {
      if (!r.cardmarketId) {
        notFound.push({
          status: "NOT FOUND",
          reason: "NO_CARDMARKET_ID_MATCH",
          name: r.line.name,
          setFull: r.line.setFull,
          setCode: r.line.setCode,
          collectorNumber: r.line.collectorNumber,
          isFoil: r.line.isFoil,
          qty: r.line.qty,
        });
      }
    }

    const okResolved = resolved.filter((r) => !!r.cardmarketId) as { line: ParsedLine; cardmarketId: number }[];
    const ids = Array.from(new Set(okResolved.map((r) => r.cardmarketId)));

    // 5) Signals from view (raw SQL)
    const signals = ids.length
      ? await prisma.$queryRaw<any[]>`
          select
            "cardmarketId",
            "name",
            lower("set") as "set",
            "collectorNumber",
            "rarity",
            "trend",
            "foilTrend",
            "tix",
            "edhrecRank",
            "gameChanger"
          from "V_CardValueSignals"
          where "cardmarketId" = any(${ids})
        `
      : [];

    const sigById = new Map<number, any>();
    for (const s of signals) sigById.set(s.cardmarketId, s);

    // 6) ownQty context
    const inv = ids.length
      ? await prisma.inventoryBalance.groupBy({
          where: { cardmarketId: { in: ids } },
          by: ["cardmarketId"],
          _sum: { qtyOnHand: true },
        })
      : [];

    const onHandById = new Map<number, number>(
      inv.map((r) => [r.cardmarketId as number, r._sum.qtyOnHand ?? 0])
    );

    const pendingById = ids.length ? await getPendingQtyByCardmarketId(ids) : new Map<number, number>();

    // 7) Quote
    const buying: any[] = [];
    const notBuying: any[] = [];

    for (const r of okResolved) {
      const sig = sigById.get(r.cardmarketId) ?? null;

      if (!sig) {
        notFound.push({
          status: "NOT FOUND",
          reason: "NO_SIGNALS",
          name: r.line.name,
          setFull: r.line.setFull,
          setCode: r.line.setCode,
          collectorNumber: r.line.collectorNumber,
          isFoil: r.line.isFoil,
          qty: r.line.qty,
        });
        continue;
      }

      const ownOnHand = onHandById.get(r.cardmarketId) ?? 0;
      const ownPending = pendingById.get(r.cardmarketId) ?? 0;
      const ownQty = ownOnHand + ownPending;

      const engine = computeUnitFromTrend({
        trend: sig.trend ?? null,
        trendFoil: sig.foilTrend ?? null,
        isFoil: r.line.isFoil,
        cond: defaultCond,
        ctx: {
          edhrecRank: sig.edhrecRank ?? null,
          mtgoTix: sig.tix ?? null,
          gameChanger: sig.gameChanger ?? false,
          ownQty,
        },
      });

      const usedTrend = engine.usedTrend ?? 0;
      const unit = engine.unit ?? 0;
      const lineTotal = Math.round(unit * r.line.qty * 100) / 100;

      const out = {
        status: engine.allowed ? "BUYING" : "NOT BUYING",
        reason: engine.allowed ? "" : "ENGINE_DISALLOWED",
        cardmarketId: r.cardmarketId,

        name: sig.name ?? r.line.name,
        setCode: (sig.set ?? r.line.setCode ?? "").toLowerCase(),
        collectorNumber: sig.collectorNumber ?? r.line.collectorNumber ?? null,
        rarity: sig.rarity ?? null,

        isFoil: r.line.isFoil,
        cond: defaultCond,
        qty: r.line.qty,

        trendNonFoil: sig.trend ?? null,
        trendFoil: sig.foilTrend ?? null,
        usedTrend: usedTrend ? Math.round(usedTrend * 100) / 100 : 0,

        pct: engine.pct ?? 0,
        unit,
        lineTotal,

        ownQty,
        tix: sig.tix ?? null,
        edhrecRank: sig.edhrecRank ?? null,
        gameChanger: sig.gameChanger ?? false,
      };

      if (engine.allowed) buying.push(out);
      else notBuying.push(out);
    }

    const totalBuying = Math.round(buying.reduce((s, x) => s + (x.lineTotal ?? 0), 0) * 100) / 100;

    return NextResponse.json({
      ok: true,
      defaultCond,
      counts: {
        inputLines: customer.length,
        aggregatedLines: lines.length,
        buyingLines: buying.length,
        notBuyingLines: notBuying.length,
        notFoundLines: notFound.length,
      },
      totals: { buyingTotalEur: totalBuying },
      buying,
      notBuying,
      notFound,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "internal error" }, { status: 500 });
  }
}
