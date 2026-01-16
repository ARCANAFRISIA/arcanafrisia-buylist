// src/app/api/admin/syp/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SypRow = {
  tcgplayerId: number;
  category: string;
  productName: string;
  collectorNumber: string | null;
  rarity: string | null;
  setName: string | null;
  condition: string | null;
  marketPrice: number | null;
  maxQty: number;
};

function normalizeHeader(h: string) {
  return (h ?? "").trim().toLowerCase();
}

// CSV parser with quote support (RFC-ish):
// - separator auto-detect between comma and tab and semicolon
// - handles commas inside quotes
function parseCsv(text: string): string[][] {
  const s = (text ?? "").replace(/^\uFEFF/, ""); // strip BOM
  const lines = s.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];

  // detect delimiter by checking header line
  const headerLine = lines[0];
  const candidates = [",", "\t", ";"];
  let bestDelim = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const c = (headerLine.match(new RegExp(`\\${d}`, "g")) || []).length;
    if (c > bestCount) {
      bestCount = c;
      bestDelim = d;
    }
  }

  const rows: string[][] = [];
  for (const line of lines) {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        // escaped quote "" inside quoted field
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }

      if (!inQuotes && ch === bestDelim) {
        out.push(cur.trim());
        cur = "";
        continue;
      }

      cur += ch;
    }
    out.push(cur.trim());
    rows.push(out);
  }

  return rows;
}

function toInt(raw: string): number | null {
  const n = Number(String(raw ?? "").trim());
  return Number.isInteger(n) ? n : null;
}

function toNumber(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const normalized = s.replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
}


function clampMaxQty(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1000000, Math.trunc(n)));
}

// Batch upsert via raw SQL (fast). We upsert on tcgplayerId.
async function upsertBatch(rows: SypRow[]) {
  if (!rows.length) return { insertedOrUpdated: 0 };

  // Build:
  // INSERT INTO "SypDemand" (...) VALUES (...), (...)
  // ON CONFLICT ("tcgplayerId") DO UPDATE SET ...
  //
  // Use parameter placeholders $1..$N
  const cols = [
    `"tcgplayerId"`,
    `"category"`,
    `"productName"`,
    `"setName"`,
    `"collectorNumber"`,
    `"rarity"`,
    `"condition"`,
    `"marketPrice"`,
    `"maxQty"`,
    `"updatedAt"`,
  ];

  const values: any[] = [];
  const tuples: string[] = [];

  let p = 1;
  for (const r of rows) {
    tuples.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
    );
    values.push(
      r.tcgplayerId,
      r.category,
      r.productName,
      r.setName,
      r.collectorNumber,
      r.rarity,
      r.condition,
      r.marketPrice == null ? null : r.marketPrice, // numeric
      r.maxQty,
      new Date()
    );
  }

  const sql = `
    INSERT INTO "SypDemand" (${cols.join(",")})
    VALUES ${tuples.join(",")}
    ON CONFLICT ("tcgplayerId") DO UPDATE SET
      "category"        = EXCLUDED."category",
      "productName"     = EXCLUDED."productName",
      "setName"         = EXCLUDED."setName",
      "collectorNumber" = EXCLUDED."collectorNumber",
      "rarity"          = EXCLUDED."rarity",
      "condition"       = EXCLUDED."condition",
      "marketPrice"     = EXCLUDED."marketPrice",
      "maxQty"          = EXCLUDED."maxQty",
      "updatedAt"       = EXCLUDED."updatedAt"
  `;

  // @ts-ignore
  await prisma.$executeRawUnsafe(sql, ...values);
  return { insertedOrUpdated: rows.length };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const csvText = (body?.csv ?? "").toString();

    if (!csvText || typeof csvText !== "string") {
      return NextResponse.json({ ok: false, error: "missing csv text" }, { status: 400 });
    }

    const table = parseCsv(csvText);
    if (!table.length) {
      return NextResponse.json({ ok: false, error: "empty csv" }, { status: 400 });
    }

    const header = table[0].map(normalizeHeader);
    const data = table.slice(1);

    const col = (name: string) => header.indexOf(normalizeHeader(name));

    const iId = col("TCGplayer Id");
    const iCat = col("Category");
    const iName = col("Product Name");
    const iNum = col("Number");
    const iRarity = col("Rarity");
    const iSet = col("Set");
    const iCond = col("Condition");
    const iPrice = col("Market Price");
    const iMax = col("Max QTY");

    const missing = [
      ["TCGplayer Id", iId],
      ["Category", iCat],
      ["Product Name", iName],
      ["Max QTY", iMax],
    ]
      .filter(([, idx]) => Number(idx) < 0)

      .map(([n]) => n);

    if (missing.length) {
      return NextResponse.json(
        { ok: false, error: `missing required columns: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    let totalRows = 0;
    let magicRows = 0;
    let pokemonRows = 0;
    let invalidRows = 0;

    const parsed: SypRow[] = [];
    const errors: { line: number; message: string }[] = [];

    for (let r = 0; r < data.length; r++) {
      totalRows++;
      const line = r + 2;
      const row = data[r];

      const cat = (row[iCat] ?? "").trim();
      if (cat === "Pokemon") pokemonRows++;
      if (cat === "Magic") magicRows++;

      // Keep non-magic out of DB for now (your choice)
      if (cat !== "Magic") continue;

      const id = toInt(row[iId] ?? "");
      const productName = (row[iName] ?? "").trim();
      const maxQty = toInt(row[iMax] ?? "");

      if (!id || id <= 0) {
        invalidRows++;
        errors.push({ line, message: `invalid tcgplayer id: ${row[iId]}` });
        continue;
      }
      if (!productName) {
        invalidRows++;
        errors.push({ line, message: `missing product name` });
        continue;
      }
      if (maxQty == null) {
        invalidRows++;
        errors.push({ line, message: `invalid Max QTY: ${row[iMax]}` });
        continue;
      }

      const collectorNumber = iNum >= 0 ? (row[iNum] ?? "").trim() || null : null;
      const rarity = iRarity >= 0 ? (row[iRarity] ?? "").trim() || null : null;
      const setName = iSet >= 0 ? (row[iSet] ?? "").trim() || null : null;
      const condition = iCond >= 0 ? (row[iCond] ?? "").trim() || null : null;
      const marketPrice = iPrice >= 0 ? toNumber(row[iPrice] ?? "") : null;


      parsed.push({
        tcgplayerId: id,
        category: cat,
        productName,
        collectorNumber,
        rarity,
        setName,
        condition,
        marketPrice,
        maxQty: clampMaxQty(maxQty),
      });
    }

    // Upsert in batches
    const BATCH = 500;
    let upserted = 0;

    for (let i = 0; i < parsed.length; i += BATCH) {
      const batch = parsed.slice(i, i + BATCH);
      const res = await upsertBatch(batch);
      upserted += res.insertedOrUpdated;
    }

    // Some stats
    const hotThreshold = 10;
    const hotCount = parsed.reduce((acc, r) => acc + (r.maxQty >= hotThreshold ? 1 : 0), 0);

    // Return a top list for quick sanity check
    const top = await prisma.sypDemand.findMany({
      orderBy: [{ maxQty: "desc" }],
      take: 25,
      select: {
        tcgplayerId: true,
        productName: true,
        setName: true,
        collectorNumber: true,
        rarity: true,
        condition: true,
        marketPrice: true,
        maxQty: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      totalRowsInFile: totalRows,
      magicRowsInFile: magicRows,
      pokemonRowsInFile: pokemonRows,
      magicRowsParsed: parsed.length,
      upsertedRows: upserted,
      hotThreshold,
      hotCount,
      invalidRows,
      errors: errors.slice(0, 200),
      top,
    });
  } catch (e: any) {
    console.error("syp upload error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
