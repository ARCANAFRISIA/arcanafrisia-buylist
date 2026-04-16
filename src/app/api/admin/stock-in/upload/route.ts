// src/app/api/admin/stock-in/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parse } from "csv-parse/sync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type UploadRowError = { line: number; message: string };

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
};

type NormalizedRow = {
  line: number;
  cardmarketId: number;
  qty: number;
  condition: string;
  language: string;
  isFoil: boolean;
  unitCostEur: number;
  sourceCode: string;
  sourceDate: Date;
};

function detectDelimiter(csv: string) {
  const firstLine = (csv || "").split(/\r?\n/)[0] || "";
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons > commas ? ";" : ",";
}

function cleanHeader(s: unknown) {
  return String(s ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function getValue(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  return null;
}

function toBool(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "y" || s === "yes" || s === "foil";
}

function toNumber(v: unknown, fallback = 0): number {
  if (v == null || String(v).trim() === "") return fallback;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function todayUTC(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function normalizeLanguage(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();

  if (!s) return "";
  if (["english", "en", "eng"].includes(s)) return "EN";
  if (["german", "de", "ger", "deutsch"].includes(s)) return "DE";
  if (["french", "fr", "fra", "français", "francais"].includes(s)) return "FR";
  if (["spanish", "es", "spa", "español", "espanol"].includes(s)) return "ES";
  if (["italian", "it", "ita", "italiano"].includes(s)) return "IT";
  if (["portuguese", "pt", "por"].includes(s)) return "PT";
  if (["japanese", "jp", "ja"].includes(s)) return "JP";
  if (["korean", "kr", "ko"].includes(s)) return "KO";
  if (["chinese simplified", "zhs", "cs"].includes(s)) return "ZHS";
  if (["chinese traditional", "zht", "ct"].includes(s)) return "ZHT";
  if (["russian", "ru"].includes(s)) return "RU";

  return String(v ?? "").trim().toUpperCase();
}

function normalizeCondition(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();

  if (!s) return "";
  if (s === "NEAR MINT") return "NM";
  if (s === "MINT") return "NM";
  if (s === "EXCELLENT") return "EX";
  if (s === "GOOD") return "GD";
  if (s === "LIGHT PLAYED") return "LP";
  if (s === "MODERATE PLAYED") return "MP";
  if (s === "HEAVY PLAYED") return "HP";
  if (s === "POOR") return "PO";

  return s;
}

function parseFlexibleDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return iso;

  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

function consolidateRows(rows: NormalizedRow[]) {
  const map = new Map<string, NormalizedRow>();

  for (const row of rows) {
    const key = [
      row.cardmarketId,
      row.isFoil ? 1 : 0,
      row.condition,
      row.language,
      row.sourceCode,
      row.sourceDate.toISOString().slice(0, 10),
      row.unitCostEur,
    ].join("|");

    const existing = map.get(key);
    if (existing) {
      const newQty = existing.qty + row.qty;
      const prevTotal = existing.qty * existing.unitCostEur;
      const addTotal = row.qty * row.unitCostEur;
      existing.qty = newQty;
      existing.unitCostEur = newQty > 0 ? (prevTotal + addTotal) / newQty : row.unitCostEur;
    } else {
      map.set(key, { ...row });
    }
  }

  return Array.from(map.values());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const csv = String(body?.csv || "");
    const defaultSourceCode = String(body?.defaultSourceCode || "").trim();
    const defaultSourceDateInput = String(body?.defaultSourceDate || "").trim();

    if (!csv.trim()) {
      return NextResponse.json({ ok: false, error: "CSV ontbreekt" }, { status: 400 });
    }

    const defaultSourceDate =
  parseFlexibleDate(defaultSourceDateInput) || todayUTC();
    const delimiter = detectDelimiter(csv);

    const rawRows = parse(csv, {
      columns: (headers: string[]) => headers.map(cleanHeader),
      skip_empty_lines: true,
      trim: true,
      delimiter,
      relax_column_count: true,
    }) as Array<Record<string, string>>;

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return NextResponse.json({ ok: false, error: "CSV bevat geen rijen" }, { status: 400 });
    }

    const warnings: Array<string | { line: number; message: string }> = [];
    const rowErrors: UploadRowError[] = [];
    const normalized: NormalizedRow[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const line = i + 2;
      const r = rawRows[i];

      const cardmarketId = toNumber(
        getValue(r, ["cardmarketId", "CardmarketId", "idProduct"]),
        NaN
      );
      const qty = toNumber(getValue(r, ["qty", "quantity", "qtyOnHand"]), 0);
      const condition = normalizeCondition(getValue(r, ["condition", "state"]));
      const language = normalizeLanguage(getValue(r, ["language", "lang"]));
      const isFoil = toBool(getValue(r, ["isFoil", "foil"]) ?? false);

      const unitCostRaw = getValue(r, [
        "unitCostEur",
        "avgUnitCostEur",
        "costPrice",
        "price",
      ]);
      const unitCostEur = toNumber(unitCostRaw, NaN);

      const explicitSourceCode = String(getValue(r, ["sourceCode"]) ?? "").trim();
      const comment = String(getValue(r, ["comment"]) ?? "").trim();
      const oldCommentPresent = String(getValue(r, ["oldComment"]) ?? "").trim();

      if (oldCommentPresent) {
        warnings.push({ line, message: "oldComment genegeerd" });
      }

      const sourceCode = explicitSourceCode || comment || defaultSourceCode || "";
      const sourceDate =
        parseFlexibleDate(getValue(r, ["sourceDate"])) ||
        defaultSourceDate ||
        new Date();

      if (!Number.isFinite(cardmarketId) || cardmarketId <= 0) {
        rowErrors.push({ line, message: "Ongeldige of ontbrekende cardmarketId" });
        continue;
      }

      if (!condition) {
        rowErrors.push({ line, message: "Conditie ontbreekt" });
        continue;
      }

      if (!Number.isFinite(qty) || qty <= 0) {
        rowErrors.push({ line, message: "Qty moet groter zijn dan 0" });
        continue;
      }

      if (!language) {
        rowErrors.push({ line, message: "Language ontbreekt" });
        continue;
      }

      if (!sourceCode) {
        rowErrors.push({
          line,
          message: "Source ontbreekt (sourceCode, comment of default source code)",
        });
        continue;
      }

      if (!Number.isFinite(unitCostEur) || unitCostEur < 0) {
        rowErrors.push({
          line,
          message: "Kostprijs ontbreekt of is ongeldig (unitCostEur, costPrice of price)",
        });
        continue;
      }

      normalized.push({
        line,
        cardmarketId,
        qty,
        condition,
        language,
        isFoil,
        unitCostEur,
        sourceCode,
        sourceDate,
      });
    }

    if (!normalized.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "Geen geldige rijen gevonden",
          rowsParsed: rawRows.length,
          rowErrors,
          warnings,
        },
        { status: 400 }
      );
    }

    const consolidated = consolidateRows(normalized);
    const uniqueIds = Array.from(new Set(consolidated.map((r) => r.cardmarketId)));

    const lookupRows = await prisma.scryfallLookup.findMany({
      where: { cardmarketId: { in: uniqueIds } },
      select: { cardmarketId: true, name: true, set: true, collectorNumber: true },
    });

    const lookupByCmid = new Map<
      number,
      { name: string; set: string; collectorNumber: string | null }
    >();

    for (const l of lookupRows) {
      lookupByCmid.set(Number(l.cardmarketId), {
        name: l.name,
        set: l.set,
        collectorNumber: l.collectorNumber ?? null,
      });
    }

    let lotsCreated = 0;
    let balancesUpserted = 0;
    let setLocationCount = 0;

    const picklist: PickRow[] = [];

    for (const row of consolidated) {
      const lu = lookupByCmid.get(row.cardmarketId);
      const setCode = (lu?.set ?? "").trim().toUpperCase();
      const location = setCode ? `SET-${setCode}` : null;

      if (!setCode) {
        warnings.push(`missing_set_lookup:${row.cardmarketId}`);
      }

      if (!location) {
        rowErrors.push({
          line: row.line,
          message: `Geen set-locatie beschikbaar voor cardmarketId ${row.cardmarketId}`,
        });
        continue;
      }

      try {
        await prisma.$transaction(
          async (tx) => {
            const lot = await tx.inventoryLot.create({
              data: {
                cardmarketId: row.cardmarketId,
                isFoil: row.isFoil,
                condition: row.condition,
                language: row.language,
                qtyIn: row.qty,
                qtyRemaining: row.qty,
                avgUnitCostEur: String(row.unitCostEur),
                location,
                sourceCode: row.sourceCode,
                sourceDate: row.sourceDate,
              },
            });

            await tx.inventoryTxn.create({
              data: {
                kind: "LOT_IN",
                ts: new Date(),
                cardmarketId: row.cardmarketId,
                isFoil: row.isFoil,
                condition: row.condition,
                qty: row.qty,
                unitCostEur: String(row.unitCostEur),
                refSource: row.sourceCode,
                refExternalId: lot.id,
              },
            });

            const balanceKey = {
              cardmarketId: row.cardmarketId,
              isFoil: row.isFoil,
              condition: row.condition,
              language: row.language,
            };

            const existing = await tx.inventoryBalance.findUnique({
              where: {
                cardmarketId_isFoil_condition_language: balanceKey,
              },
            });

            if (!existing) {
              await tx.inventoryBalance.create({
                data: {
                  ...balanceKey,
                  qtyOnHand: row.qty,
                  avgUnitCostEur: String(row.unitCostEur),
                },
              });
            } else {
              const oldQty = Number(existing.qtyOnHand || 0);
              const addQty = Number(row.qty || 0);
              const newQty = oldQty + addQty;

              const oldAvg = Number(existing.avgUnitCostEur || 0);
              const weighted =
                newQty > 0
                  ? ((oldQty * oldAvg) + addQty * row.unitCostEur) / newQty
                  : row.unitCostEur;

              await tx.inventoryBalance.update({
                where: {
                  cardmarketId_isFoil_condition_language: balanceKey,
                },
                data: {
                  qtyOnHand: newQty,
                  avgUnitCostEur: String(weighted),
                },
              });
            }
          },
          {
            maxWait: 10_000,
            timeout: 20_000,
          }
        );

        lotsCreated++;
        balancesUpserted++;
        setLocationCount++;

        picklist.push({
          location,
          set: lu?.set ?? "",
          name: lu?.name ?? "",
          collectorNumber: lu?.collectorNumber ?? null,
          condition: row.condition,
          language: row.language,
          isFoil: row.isFoil,
          qty: row.qty,
          cardmarketId: row.cardmarketId,
          sourceCode: row.sourceCode,
          sourceDate: row.sourceDate.toISOString(),
          unitCostEur: row.unitCostEur,
        });
      } catch (err: any) {
        rowErrors.push({
          line: row.line,
          message: `DB fout bij import van ${row.cardmarketId}: ${String(err?.message || err)}`,
        });
      }
    }

    picklist.sort((a, b) => {
      return (
        a.location.localeCompare(b.location) ||
        a.set.localeCompare(b.set) ||
        a.name.localeCompare(b.name) ||
        a.condition.localeCompare(b.condition)
      );
    });

    return NextResponse.json({
      ok: rowErrors.length === 0,
      rowsParsed: rawRows.length,
      rowsConsolidated: consolidated.length,
      lotsCreated,
      balancesUpserted,
      setLocationCount,
      rowErrors,
      warnings,
      picklist,
    });
  } catch (e: any) {
    console.error("stock-in upload error", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}