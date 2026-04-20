import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---- types ----

type CmRow = {
  cardmarketId: number;
  name: string | null;
  setCode: string | null;
  language: string;
  condition: string;
  isFoil: boolean;
  qty: number; // playsets already expanded
};

type InvRow = {
  cardmarketId: number;
  name: string | null;
  setCode: string | null;
  language: string;
  condition: string;
  isFoil: boolean;
  qtyOnHand: number; // CM-eligible qty only
};

type Tier = {
  minOnHand: number;
  listQty: number;
};

type AuditRow = {
  key: string;
  cardmarketId: number;
  name: string | null;
  setCode: string | null;
  language: string;
  condition: string;
  isFoil: boolean;
  cmQty: number;
  onHand: number; // CM-eligible qty
  desiredOnline: number;
  deltaPolicy: number;
  deltaStock: number;
};

type LookupRow = {
  cardmarketId: number;
  scryfallId: string | null;
  oracleId: string | null;
  tix: number | null;
};

type FallbackRow = {
  scryfallId: string;
  oracleId: string | null;
  tix: number | null;
};

// ---- helpers ----

function buildKey(
  cmid: number,
  language: string,
  condition: string,
  isFoil: boolean
): string {
  return `${cmid}|${language}|${condition}|${isFoil ? "F" : "N"}`;
}

function normalizeCMLanguage(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v.startsWith("english")) return "EN";
  if (v.startsWith("german")) return "DE";
  if (v.startsWith("french")) return "FR";
  if (v.startsWith("spanish")) return "ES";
  if (v.startsWith("italian")) return "IT";
  if (v.startsWith("portuguese")) return "PT";
  if (v.startsWith("russian")) return "RU";
  if (v.startsWith("japanese")) return "JP";
  if (v.startsWith("korean")) return "KR";
  if (v.startsWith("chinese")) return "CN";
  return raw.trim().toUpperCase().slice(0, 2);
}

function normalizeCMCondition(raw: string): string {
  const v = raw.trim().toUpperCase();
  if (v.startsWith("M")) return "MT";
  if (v.startsWith("NM")) return "NM";
  if (v.startsWith("EX")) return "EX";
  if (v.startsWith("GD")) return "GD";
  if (v.startsWith("LP") || v.startsWith("PL")) return "PL";
  if (v.startsWith("PO")) return "PO";
  return v;
}

function normalizeInvCondition(raw: string): string {
  const v = (raw || "").trim().toUpperCase();
  if (v === "NEAR MINT") return "NM";
  if (v === "SLIGHTLY PLAYED") return "EX";
  if (v === "MODERATELY PLAYED") return "GD";
  if (v === "PLAYED" || v === "LP" || v === "PL") return "PL";
  if (v === "HEAVILY PLAYED") return "PL";
  return v || "NM";
}

function parseBooleanFoil(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return false;
  return ["yes", "foil", "foiled", "1", "true"].includes(v);
}

function getBaseCap(qtyOnHand: number, tiers: Tier[]): number {
  if (!tiers.length) return 0;
  const sorted = [...tiers].sort((a, b) => b.minOnHand - a.minOnHand);
  for (const t of sorted) {
    if (qtyOnHand >= t.minOnHand) return t.listQty;
  }
  return 0;
}

function applyPlaysetPremium(params: {
  baseCap: number;
  qty: number;
  isFoil: boolean;
  tix: number | null | undefined;
}) {
  const { baseCap, qty, isFoil, tix } = params;
  if (isFoil) return baseCap;
  if (qty < 4) return baseCap;
  if (tix == null || !(tix > 3)) return baseCap;
  return Math.max(baseCap, 4);
}

function computeDesiredOnline(qtyOnHand: number, tiers: Tier[], isFoil: boolean, tix: number | null | undefined): number {
  const baseCap = getBaseCap(qtyOnHand, tiers);
  return applyPlaysetPremium({
    baseCap,
    qty: qtyOnHand,
    isFoil,
    tix,
  });
}

function toCsvLine(values: (string | number | boolean)[], sep = ";"): string {
  return values
    .map((v) => {
      const s = String(v ?? "");
      if (s.includes(sep) || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(sep);
}

// ---- CSV helpers ----

function splitCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

function normalizeHeaderName(raw: string): string {
  let s = raw.replace(/^\uFEFF/, "").trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
  }
  return s.trim().toLowerCase();
}

// ---- CSV parser for Cardmarket export ----

function parseCmCsv(text: string): CmRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];

  const headerLine = lines[0];

  const sep =
    (headerLine.match(/;/g)?.length || 0) >=
    (headerLine.match(/,/g)?.length || 0)
      ? ";"
      : ",";

  const rawHeaderCells = splitCsvLine(headerLine, sep);
  const header = rawHeaderCells.map((h) => normalizeHeaderName(h));

  const idx = (name: string) => header.indexOf(name.toLowerCase());

  const iId =
    idx("idproduct") !== -1 ? idx("idproduct") : idx("cardmarketid");

  const iQty =
    idx("count") !== -1 ? idx("count") : idx("quantity");

  const iLang = idx("language");
  const iCond = idx("condition");
  const iFoil = idx("isfoil");
  const iPlayset = idx("isplayset");

  const iName = header.findIndex((h) =>
    ["product", "name", "card", "productname"].includes(h)
  );
  const iSet = header.findIndex((h) =>
    ["setcode", "expansioncode", "editioncode", "expansion"].includes(h)
  );

  if (iId === -1 || iQty === -1 || iLang === -1 || iCond === -1) {
    throw new Error(
      "Kon kolommen idProduct/cardmarketId, Count/Quantity, Language en Condition niet vinden in de CSV-header."
    );
  }

  const rows: CmRow[] = [];

  for (let li = 1; li < lines.length; li++) {
    const rawLine = lines[li];
    if (!rawLine.trim()) continue;

    const cells = splitCsvLine(rawLine, sep);

    const get = (i: number): string =>
      (cells[i] ?? "").replace(/^\uFEFF/, "").trim().replace(/^"|"$/g, "");

    const id = Number(get(iId));
    const qtyRaw = Number(get(iQty) || "0");
    if (!Number.isFinite(id) || !Number.isFinite(qtyRaw)) continue;

    const langRaw = get(iLang);
    const condRaw = get(iCond);
    const foilRaw = iFoil === -1 ? "" : get(iFoil);
    const playsetRaw = iPlayset === -1 ? "" : get(iPlayset);

    const name = iName === -1 ? null : get(iName) || null;
    const setCode = iSet === -1 ? null : get(iSet) || null;

    const isFoil = parseBooleanFoil(foilRaw);
    const language = normalizeCMLanguage(langRaw);
    const condition = normalizeCMCondition(condRaw);

    const isPlayset =
      playsetRaw.length > 0 &&
      !["0", "no", "false"].includes(playsetRaw.toLowerCase());
    const qty = isPlayset ? qtyRaw * 4 : qtyRaw;

    rows.push({
      cardmarketId: id,
      name,
      setCode,
      language,
      condition,
      isFoil,
      qty,
    });
  }

  return rows;
}

// ---- handler ----

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Upload een bestand onder de naam 'file'." },
        { status: 400 }
      );
    }

    const text = await file.text();
    const cmRows = parseCmCsv(text);

    // map CM (per cmid+taal+conditie+foil)
    const cmMap = new Map<string, CmRow>();
    const cmCardmarketIds = new Set<number>();

    for (const row of cmRows) {
      const key = buildKey(
        row.cardmarketId,
        row.language,
        row.condition,
        row.isFoil
      );
      const existing = cmMap.get(key);
      if (existing) {
        existing.qty += row.qty;
      } else {
        cmMap.set(key, { ...row });
      }
      cmCardmarketIds.add(row.cardmarketId);
    }

    // CM policy + tiers
    const policy = await prisma.listPolicy.findFirst({
      where: { channel: "CM", enabled: true },
      include: { tiers: true },
    });

    if (!policy) {
      return NextResponse.json(
        { ok: false, error: "No enabled ListPolicy for CM channel." },
        { status: 400 }
      );
    }

    const tiers: Tier[] = policy.tiers
      .map((t) => ({
        minOnHand: t.minOnHand,
        listQty: t.listQty,
      }))
      .sort((a, b) => b.minOnHand - a.minOnHand);

    // InventoryLot -> CM eligible qty only (non-CB)
    type LotAgg = {
      cardmarketId: number;
      language: string;
      condition: string;
      isFoil: boolean;
      qty: unknown;
    };

    const invRows = await prisma.$queryRawUnsafe<LotAgg[]>(
      `
      SELECT
        "cardmarketId",
        UPPER(COALESCE("language",'EN')) AS "language",
        UPPER(COALESCE("condition",'NM')) AS "condition",
        COALESCE("isFoil", false) AS "isFoil",
        COALESCE(SUM("qtyRemaining"),0) AS qty
      FROM "InventoryLot"
      WHERE "qtyRemaining" > 0
        AND "location" IS NOT NULL
        AND "location" NOT LIKE 'CB-%'
      GROUP BY 1,2,3,4
      `
    );

    const invMap = new Map<string, InvRow>();

    for (const b of invRows) {
      const language = (b.language || "EN").toUpperCase();
      const condition = normalizeInvCondition(b.condition);
      const isFoil = Boolean(b.isFoil);
      const qtyOnHand = Number(b.qty || 0);

      const key = buildKey(b.cardmarketId, language, condition, isFoil);

      invMap.set(key, {
        cardmarketId: b.cardmarketId,
        name: null,
        setCode: null,
        language,
        condition,
        isFoil,
        qtyOnHand,
      });

      cmCardmarketIds.add(b.cardmarketId);
    }

    // tix map (direct lookup, then fallback)
    const allCmIds = Array.from(cmCardmarketIds);
    const tixMap = new Map<number, number>();

    if (allCmIds.length) {
      const lookupRows = await prisma.$queryRawUnsafe<LookupRow[]>(
        `SELECT "cardmarketId","scryfallId","oracleId","tix" FROM "ScryfallLookup" WHERE "cardmarketId" = ANY($1)`,
        allCmIds
      );

      const missingScryfallIds = new Set<string>();
      const missingOracleIds = new Set<string>();
      const lookupByCardmarketId = new Map<number, LookupRow>();

      for (const row of lookupRows) {
        lookupByCardmarketId.set(Number(row.cardmarketId), row);

        if (row.tix != null && Number(row.tix) > 0) {
          tixMap.set(Number(row.cardmarketId), Number(row.tix));
        } else {
          if (row.scryfallId) missingScryfallIds.add(row.scryfallId);
          if (row.oracleId) missingOracleIds.add(row.oracleId);
        }
      }

      if (missingScryfallIds.size || missingOracleIds.size) {
        const sfIds = Array.from(missingScryfallIds);
        const orIds = Array.from(missingOracleIds);

        let fallbackRows: FallbackRow[] = [];

        if (sfIds.length && orIds.length) {
          fallbackRows = await prisma.$queryRawUnsafe<FallbackRow[]>(
            `
            SELECT "scryfallId","oracleId","tix"
            FROM "ScryfallTixFallback"
            WHERE "scryfallId" = ANY($1)
               OR "oracleId" = ANY($2)
            `,
            sfIds,
            orIds
          );
        } else if (sfIds.length) {
          fallbackRows = await prisma.$queryRawUnsafe<FallbackRow[]>(
            `
            SELECT "scryfallId","oracleId","tix"
            FROM "ScryfallTixFallback"
            WHERE "scryfallId" = ANY($1)
            `,
            sfIds
          );
        } else if (orIds.length) {
          fallbackRows = await prisma.$queryRawUnsafe<FallbackRow[]>(
            `
            SELECT "scryfallId","oracleId","tix"
            FROM "ScryfallTixFallback"
            WHERE "oracleId" = ANY($1)
            `,
            orIds
          );
        }

        const fallbackByScryfallId = new Map<string, number>();
        const fallbackByOracleId = new Map<string, number>();

        for (const row of fallbackRows) {
          const tix = row.tix != null ? Number(row.tix) : null;
          if (!(tix != null && tix > 0)) continue;

          if (row.scryfallId && !fallbackByScryfallId.has(row.scryfallId)) {
            fallbackByScryfallId.set(row.scryfallId, tix);
          }
          if (row.oracleId && !fallbackByOracleId.has(row.oracleId)) {
            fallbackByOracleId.set(row.oracleId, tix);
          }
        }

        for (const [cardmarketId, row] of lookupByCardmarketId.entries()) {
          if (tixMap.has(cardmarketId)) continue;

          const fallbackTix =
            (row.scryfallId ? fallbackByScryfallId.get(row.scryfallId) : undefined) ??
            (row.oracleId ? fallbackByOracleId.get(row.oracleId) : undefined);

          if (fallbackTix != null && fallbackTix > 0) {
            tixMap.set(cardmarketId, fallbackTix);
          }
        }
      }
    }

    // union van alle keys
    const allKeys = new Set<string>();
    for (const k of cmMap.keys()) allKeys.add(k);
    for (const k of invMap.keys()) allKeys.add(k);

    const auditRows: AuditRow[] = [];

    for (const key of allKeys) {
      const cm = cmMap.get(key);
      const inv = invMap.get(key);

      const cmQty = cm?.qty ?? 0;
      const onHand = inv?.qtyOnHand ?? 0;

      const cardmarketId = cm?.cardmarketId ?? inv?.cardmarketId ?? 0;
      const language = cm?.language ?? inv?.language ?? "";
      const condition = cm?.condition ?? inv?.condition ?? "";
      const isFoil = cm?.isFoil ?? inv?.isFoil ?? false;

      const name = cm?.name ?? inv?.name ?? null;
      const setCode = cm?.setCode ?? inv?.setCode ?? null;

      const tix = tixMap.get(cardmarketId) ?? null;
      const desiredOnline = computeDesiredOnline(onHand, tiers, isFoil, tix);

      const deltaPolicy = cmQty - desiredOnline;
      const deltaStock = cmQty - onHand;

      auditRows.push({
        key,
        cardmarketId,
        name,
        setCode,
        language,
        condition,
        isFoil,
        cmQty,
        onHand,
        desiredOnline,
        deltaPolicy,
        deltaStock,
      });
    }

    // --- classificatie ---
    // meer op CM dan wenselijk volgens policy of fysiek veilig
    const tooMuch = auditRows.filter(
      (r) => r.cmQty > Math.max(0, Math.min(r.onHand, r.desiredOnline))
    );

    // minder op CM dan gewenst volgens policy, terwijl er voorraad is
    const tooLittle = auditRows.filter(
      (r) => r.onHand > 0 && r.cmQty < Math.max(0, Math.min(r.onHand, r.desiredOnline))
    );

    // puur live CM vs fysieke CM-eligible voorraad
    const stockMismatch = auditRows.filter((r) => r.deltaStock !== 0);

    const header = [
      "cardmarketId",
      "name",
      "setCode",
      "language",
      "condition",
      "isFoil",
      "cmQty",
      "onHand",
      "desiredOnline",
      "deltaPolicy",
      "deltaStock",
      "suggestedNewQty",
    ];

    const tooMuchLines = [
      toCsvLine(header),
      ...tooMuch.map((r) =>
        toCsvLine([
          r.cardmarketId,
          r.name ?? "",
          r.setCode ?? "",
          r.language,
          r.condition,
          r.isFoil ? 1 : 0,
          r.cmQty,
          r.onHand,
          r.desiredOnline,
          r.deltaPolicy,
          r.deltaStock,
          Math.max(0, Math.min(r.onHand, r.desiredOnline)),
        ])
      ),
    ];

    const tooLittleLines = [
      toCsvLine(header),
      ...tooLittle.map((r) =>
        toCsvLine([
          r.cardmarketId,
          r.name ?? "",
          r.setCode ?? "",
          r.language,
          r.condition,
          r.isFoil ? 1 : 0,
          r.cmQty,
          r.onHand,
          r.desiredOnline,
          r.deltaPolicy,
          r.deltaStock,
          Math.max(0, Math.min(r.onHand, r.desiredOnline)),
        ])
      ),
    ];

    const mismatchLines = [
      toCsvLine(header),
      ...stockMismatch.map((r) =>
        toCsvLine([
          r.cardmarketId,
          r.name ?? "",
          r.setCode ?? "",
          r.language,
          r.condition,
          r.isFoil ? 1 : 0,
          r.cmQty,
          r.onHand,
          r.desiredOnline,
          r.deltaPolicy,
          r.deltaStock,
          "",
        ])
      ),
    ];

    return NextResponse.json({
      ok: true,
      summary: {
        totalSkus: auditRows.length,
        tooMuch: tooMuch.length,
        tooLittle: tooLittle.length,
        stockMismatch: stockMismatch.length,
      },
      csv: {
        tooMuchCsv: tooMuchLines.join("\n"),
        tooLittleCsv: tooLittleLines.join("\n"),
        stockMismatchCsv: mismatchLines.join("\n"),
      },
    });
  } catch (err: any) {
    console.error("cm-stock-audit error", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}