import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Input-kolommen (case-insensitive): cardmarket_id, foil, condition
// - foil: yes/no, true/false, 1/0 → bool
// - condition: NM, EX, GD, LP, PL, PO (of varianten)

type NormCond = "NM" | "EX" | "GD" | "LP" | "PL" | "PO";
const COND_MAP: Record<string, NormCond> = {
  "nm": "NM", "near mint": "NM",
  "ex": "EX", "excellent": "EX",
  "gd": "GD", "good": "GD",
  "lp": "LP", "light played": "LP", "lightly played": "LP",
  "pl": "PL", "played": "PL",
  "po": "PO", "poor": "PO",
};

// extra mapping van CM-condities naar CT buckets
const BUCKET_SYNONYMS: Record<string, string> = {
  "NM": "NM",
  "M": "NM",
  "NEAR MINT": "NM",
  "N/M": "NM",
  "EX": "EX",
  "EXCELLENT": "EX",
  "GD": "GD",
  "GOOD": "GD",
  "LP": "LP",
  "LIGHT PLAYED": "LP",
  "LIGHTLY PLAYED": "LP",
  "PL": "PL",
  "PLAYED": "PL",
  "PO": "PO",
  "POOR": "PO",
};
function toBucketLabel(cond: "NM"|"EX"|"GD"|"LP"|"PL"|"PO" | null): string | null {
  if (!cond) return null;
  const k = cond.toUpperCase();
  return BUCKET_SYNONYMS[k] ?? cond;
}


// in jouw CT tabellen heet dit veld 'bucket' (string). We nemen aan dat daar NM/EX/GD/LP/PL/PO in staat.
// Als het bij jou anders is (bijv. "NearMint"), voeg de mapping hier toe.
const BUCKET_MAP: Record<NormCond, string> = {
  NM: "NM", EX: "EX", GD: "GD", LP: "LP", PL: "PL", PO: "PO",
};

const truthy = new Set(["true","1","yes","y","ja","waar","foil"]);
function parseFoil(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return truthy.has(s);
}
function normalizeCond(v: unknown): NormCond | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return COND_MAP[s] ?? null;
}
function toCmId(v: unknown): number | null {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

type CtHit = {
  minPrice?: number | null;
  medianPrice?: number | null;
  bucket?: string | null;
  isFoil: boolean;
  cardmarketId?: number | null;
  scryfallId?: string | null;
  blueprintId?: number | null;
};

async function findCtByCardmarketId(cmId: number, isFoil: boolean, bucket?: string | null): Promise<CtHit | null> {
  if (bucket) {
    const hit = await prisma.cTMarketLatest.findFirst({
      where: { cardmarketId: cmId, isFoil, bucket },
      select: { minPrice: true, medianPrice: true, bucket: true, isFoil: true, cardmarketId: true, scryfallId: true, blueprintId: true },
    });
    return hit || null;
  } else {
    // pak de laagste minPrice over alle buckets voor deze finish
    const hits = await prisma.cTMarketLatest.findMany({
      where: { cardmarketId: cmId, isFoil },
      select: { minPrice: true, medianPrice: true, bucket: true, isFoil: true, cardmarketId: true, scryfallId: true, blueprintId: true },
    });
    if (!hits.length) return null;
    let best = hits[0];
    for (const h of hits) {
      if ((h.minPrice ?? Infinity) < (best.minPrice ?? Infinity)) best = h;
    }
    return best;
  }
}

async function findCtByScryfallId(scryId: string, isFoil: boolean, bucket?: string | null): Promise<CtHit | null> {
  if (bucket) {
    const hit = await prisma.cTMarketLatest.findFirst({
      where: { scryfallId: scryId, isFoil, bucket },
      select: { minPrice: true, medianPrice: true, bucket: true, isFoil: true, cardmarketId: true, scryfallId: true, blueprintId: true },
    });
    return hit || null;
  } else {
    const hits = await prisma.cTMarketLatest.findMany({
      where: { scryfallId: scryId, isFoil },
      select: { minPrice: true, medianPrice: true, bucket: true, isFoil: true, cardmarketId: true, scryfallId: true, blueprintId: true },
    });
    if (!hits.length) return null;
    let best = hits[0];
    for (const h of hits) {
      if ((h.minPrice ?? Infinity) < (best.minPrice ?? Infinity)) best = h;
    }
    return best;
  }
}

async function findCtByBlueprintId(blueprintId: number, isFoil: boolean, bucket?: string | null): Promise<CtHit | null> {
  if (bucket) {
    const hit = await prisma.cTMarketLatest.findFirst({
      where: { blueprintId, isFoil, bucket },
      select: { minPrice: true, medianPrice: true, bucket: true, isFoil: true, cardmarketId: true, scryfallId: true, blueprintId: true },
    });
    return hit || null;
  } else {
    const hits = await prisma.cTMarketLatest.findMany({
      where: { blueprintId, isFoil },
      select: { minPrice: true, medianPrice: true, bucket: true, isFoil: true, cardmarketId: true, scryfallId: true, blueprintId: true },
    });
    if (!hits.length) return null;
    let best = hits[0];
    for (const h of hits) {
      if ((h.minPrice ?? Infinity) < (best.minPrice ?? Infinity)) best = h;
    }
    return best;
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload een CSV in form field 'file'." }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());

    const rows: any[] = parse(buf, { columns: true, skip_empty_lines: true, bom: true, trim: true });

    const out: any[] = [];
    for (const rec of rows) {
      const rawCm = rec.cardmarket_id ?? rec.Cardmarket_ID ?? rec.cardmarketId ?? rec["cardmarket id"];
      const cmId = toCmId(rawCm);
      const isFoil = parseFoil(rec.foil ?? rec.Foil);
      const condNorm = normalizeCond(rec.condition ?? rec.Condition);
      const bucket = condNorm ? toBucketLabel(condNorm) : null;

      let match_path = "";
      let bucket_used = bucket ?? "";
      let ct_min_eur = "";
      let ct_median_eur = "";
      let scryfall_id = "";
      let blueprint_id = "";
      let _error = "";

      if (!cmId) {
        _error = "Missing/invalid cardmarket_id";
        out.push({ ...rec, isFoil, condition_norm: condNorm ?? "", bucket_used, ct_min_eur, ct_median_eur, match_path, scryfall_id, blueprint_id, _error });
        continue;
      }

      // 1) CTMarketLatest via cardmarketId
      let hit = await findCtByCardmarketId(cmId, isFoil, bucket);
      if (hit) {
        match_path = "CTMarketLatest.cardmarketId";
      } else {
        // 2) ScryfallLookup → scryfallId → CTMarketLatest
        const scry = await prisma.scryfallLookup.findUnique({
          where: { cardmarketId: cmId },
          select: { scryfallId: true },
        });
        if (scry?.scryfallId) {
          scryfall_id = scry.scryfallId;
          hit = await findCtByScryfallId(scry.scryfallId, isFoil, bucket);
          if (hit) match_path = "ScryfallLookup → CTMarketLatest";
        }
      }

      if (!hit) {
        async function findCtSummaryLatest(where:any): Promise<CtHit|null> {
  const latest = await prisma.cTMarketSummary.findFirst({
    where,
    orderBy: { capturedAt: "desc" },
    select: { minPrice:true, medianPrice:true, bucket:true, isFoil:true, cardmarketId:true, scryfallId:true, blueprintId:true }
  });
  return latest || null;
}

// ... bij elke key als laatste fallback:
if (!hit) {
  hit = await findCtSummaryLatest({ cardmarketId: cmId, isFoil, ...(bucket? { bucket } : {}) });
  if (hit) match_path = match_path || "CTMarketSummary.cardmarketId";
}
if (!hit && scryfall_id) {
  const h2 = await findCtSummaryLatest({ scryfallId: scryfall_id, isFoil, ...(bucket? { bucket } : {}) });
  if (h2) { hit = h2; match_path = match_path || "CTMarketSummary.scryfallId"; }
}
if (!hit && blueprint_id) {
  const h3 = await findCtSummaryLatest({ blueprintId: Number(blueprint_id), isFoil, ...(bucket? { bucket } : {}) });
  if (h3) { hit = h3; match_path = match_path || "CTMarketSummary.blueprintId"; }
}

        // 3) BlueprintMapping → blueprintId → CTMarketLatest
        const map = await prisma.blueprintMapping.findFirst({
          where: { cardmarketId: cmId },
          select: { blueprintId: true },
        });
        if (map?.blueprintId != null) {
          blueprint_id = String(map.blueprintId);
          hit = await findCtByBlueprintId(map.blueprintId, isFoil, bucket);
          if (hit) match_path = "BlueprintMapping → CTMarketLatest";
        }
      }

      // 4) Fallback: geen exacte bucket? probeer laagste minPrice over alle buckets
      if (!hit && condNorm) {
        // probeer zónder bucket
        hit = await findCtByCardmarketId(cmId, isFoil, null)
          || (scryfall_id ? await findCtByScryfallId(scryfall_id, isFoil, null) : null)
          || (blueprint_id ? await findCtByBlueprintId(Number(blueprint_id), isFoil, null) : null);
        if (hit && !match_path) match_path = "fallback:any-bucket";
      }

      if (hit) {
        if (hit.bucket) bucket_used = hit.bucket;
        if (hit.scryfallId) scryfall_id = hit.scryfallId ?? scryfall_id;
        if ((hit as any).blueprintId) blueprint_id = String((hit as any).blueprintId ?? blueprint_id);
        ct_min_eur = (hit.minPrice ?? null) != null ? Number(hit.minPrice).toFixed(2) : "";
        ct_median_eur = (hit.medianPrice ?? null) != null ? Number(hit.medianPrice).toFixed(2) : "";
      } else {
        _error = _error || "No CT price match";
      }

      out.push({
        ...rec,
        isFoil,
        condition_norm: condNorm ?? "",
        bucket_used,
        scryfall_id,
        blueprint_id,
        ct_min_eur,
        ct_median_eur,
        match_path,
        _error,
      });
    }

    const csv = stringify(out, { header: true });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cm_to_ct_prices.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function GET() {
  const csv = stringify(
    [
      { cardmarket_id: 123456, foil: "no", condition: "NM" },
      { cardmarket_id: 789012, foil: "yes", condition: "LP" },
      { cardmarket_id: 345678, foil: "no", condition: "" }, // geen conditie → laagste prijs per finish
    ],
    { header: true }
  );
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="template_cm_to_ct.csv"`,
    },
  });
}
