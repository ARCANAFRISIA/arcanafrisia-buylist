// src/app/api/export/idle/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Mapping van jouw language-codes (InventoryBalance.language) naar Cardmarket language IDs
const LANGUAGE_TO_CM_ID: Record<string, number> = {
  EN: 1,
  DE: 2,
  FR: 3,
  ES: 4,
  IT: 5,
  CN: 6,
  JP: 7,
  PT: 8,
  RU: 9,
  KR: 10,
  // vul later aan met NL, etc. als je wilt
};

type IdleExportRow = {
  cardmarketId: number;
  name: string | null;
  isFoil: boolean;
  condition: string;
  languageCode: string;
  languageCmId: number | null;
  qty: number;
  oldPrice: number;
  newPrice: number;
  discountPct: number;
  idleDays: number;
  cmLowEx: number | null;
  cmGermanProLow: number | null;
  ctMin: number | null;
  floorReason: string | null;
};

function parseNumberParam(
  searchParams: URLSearchParams,
  key: string,
  defaultValue: number
): number {
  const raw = searchParams.get(key);
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

/**
 * Past jouw Black Friday idle-discount toe:
 *
 * - baseDiscount = 0.20 (normaal) of 0.25 (bfMode)
 * - newPrice = oldPrice * (1 - baseDiscount)
 * - comparisonFloor = floorRatio * min(cmLowEx, ctMin) als die bestaan
 * - absoluteFloor = minPrice (bv €0.15)
 */
function applyIdleDiscount(options: {
  oldPrice: number;
  cmLowEx: number | null;
  ctMin: number | null;
  bfMode: boolean;
  floorRatio: number;
  minPrice: number;
}): { newPrice: number; discountPct: number; floorReason: string | null } {
  const { oldPrice, cmLowEx, ctMin, bfMode, floorRatio, minPrice } = options;

  if (!oldPrice || oldPrice <= 0) {
    // we verwachten hier eigenlijk nooit meer oldPrice=0 door de fallback,
    // maar voor de zekerheid:
    return {
      newPrice: minPrice,
      discountPct: +(1 - minPrice / (oldPrice || minPrice)).toFixed(4),
      floorReason: "NO_BASE_PRICE+MIN_PRICE",
    };
  }

  const baseDiscount = bfMode ? 0.25 : 0.20;
  let newPrice = +(oldPrice * (1 - baseDiscount)).toFixed(2);
  let floorReason: string | null = null;

  const cm = cmLowEx && cmLowEx > 0 ? cmLowEx : null;
  const ct = ctMin && ctMin > 0 ? ctMin : null;
  let comparisonFloor: number | null = null;

  if (cm && ct) {
    comparisonFloor = Math.min(cm, ct) * floorRatio;
  } else if (cm) {
    comparisonFloor = cm * floorRatio;
  } else if (ct) {
    comparisonFloor = ct * floorRatio;
  }

  if (comparisonFloor != null) {
    const f = +comparisonFloor.toFixed(2);
    if (newPrice < f) {
      newPrice = f;
      floorReason = "MARKET_FLOOR";
    }
  }

  if (newPrice < minPrice) {
    newPrice = minPrice;
    floorReason = floorReason ? floorReason + "+MIN_PRICE" : "MIN_PRICE";
  }

  const discountPct = +(1 - newPrice / oldPrice).toFixed(4);

  return { newPrice, discountPct, floorReason };
}

function toCsvValue(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(rows: IdleExportRow[]): string {
  const header = [
    "idProduct",
    "count",
    "price",
    "language",
    "condition",
    "isFoil",
    "name",
    "oldPrice",
    "discountPct",
    "idleDays",
    "cmLowEx",
    "cmGermanProLow",
    "ctMin",
    "floorReason",
  ];

  const lines = [header.join(",")];

  for (const row of rows) {
    const line = [
      row.cardmarketId,
      row.qty,
      row.newPrice.toFixed(2),
      row.languageCmId ?? "",
      row.condition,
      row.isFoil ? 1 : 0,
      row.name ?? "",
      row.oldPrice.toFixed(2),
      (row.discountPct * 100).toFixed(2),
      row.idleDays,
      row.cmLowEx ?? "",
      row.cmGermanProLow ?? "",
      row.ctMin ?? "",
      row.floorReason ?? "",
    ].map(toCsvValue);

    lines.push(line.join(","));
  }

  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const searchParams = url.searchParams;

    const bfMode = searchParams.get("bf") === "1";
    const minIdleDays = parseNumberParam(searchParams, "minDays", 14);
    const floorRatio = parseNumberParam(searchParams, "floorRatio", 0.8);
    const minPrice = parseNumberParam(searchParams, "minPrice", 0.15);
    const format = searchParams.get("format") || "json";

    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - minIdleDays);

    // 🔹 AANPASSING: ook lastSaleAt IS NULL meenemen als idle
    const balances = await prisma.inventoryBalance.findMany({
      where: {
        qtyOnHand: { gt: 0 },
        OR: [
          { lastSaleAt: { lte: cutoff } },
          { lastSaleAt: null },
        ],
      },
      orderBy: { lastSaleAt: "asc" },
    });

    if (balances.length === 0) {
      if (format === "csv") {
        const emptyCsv = buildCsv([]);
        return new NextResponse(emptyCsv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="idle-export-empty.csv"`,
          },
        });
      }

      return NextResponse.json(
        {
          ok: true,
          bfMode,
          minIdleDays,
          floorRatio,
          minPrice,
          count: 0,
          rows: [],
        },
        { status: 200 }
      );
    }

    const cardmarketIds = Array.from(
      new Set(
        balances
          .map((b) => b.cardmarketId)
          .filter((id): id is number => typeof id === "number")
      )
    );

    const cmPriceGuides = await prisma.cMPriceGuide.findMany({
      where: {
        cardmarketId: { in: cardmarketIds },
      },
    });

    const cmByCmid = new Map<number, any>();
    for (const row of cmPriceGuides as any[]) {
      cmByCmid.set(row.cardmarketId, row);
    }

    const ctMarketRows = await prisma.cTMarketLatest.findMany({
      where: {
        cardmarketId: { in: cardmarketIds },
      },
    });

    const ctByKey = new Map<string, any>();
    for (const row of ctMarketRows as any[]) {
      const key = `${row.cardmarketId}_${row.isFoil ? 1 : 0}`;
      ctByKey.set(key, row);
    }

    const NAME_BY_CMID = new Map<number, string | null>();

    const rows: IdleExportRow[] = [];

    for (const bal of balances as any[]) {
      const cardmarketId: number = bal.cardmarketId;
      const qty: number = bal.qtyOnHand ?? 0;
      if (!cardmarketId || qty <= 0) continue;

      const cm = cmByCmid.get(cardmarketId) || null;
      const cmLowEx: number | null = cm?.lowEx ?? null;
      const cmGermanProLow: number | null = cm?.germanProLow ?? null;

      const ctKey = `${cardmarketId}_${bal.isFoil ? 1 : 0}`;
      const ct = ctByKey.get(ctKey) || null;
      const ctMin: number | null = ct?.minPrice ?? null;

      // 🔹 AANPASSING: basePrice heeft nu altijd een fallback naar minPrice
      const basePrice: number =
        cmGermanProLow ??
        cmLowEx ??
        cm?.trend ??
        ctMin ??
        minPrice;

      const { newPrice, discountPct, floorReason } = applyIdleDiscount({
        oldPrice: basePrice,
        cmLowEx,
        ctMin,
        bfMode,
        floorRatio,
        minPrice,
      });

      // 🔹 AANPASSING: idleDays voor NULL lastSaleAt → treat as "minIdleDays"
      let idleDays: number;
      if (bal.lastSaleAt) {
        const lastSaleAt = new Date(bal.lastSaleAt);
        const idleMs = now.getTime() - lastSaleAt.getTime();
        idleDays = Math.floor(idleMs / (1000 * 60 * 60 * 24));
        if (idleDays < minIdleDays) {
          // safety, zou eigenlijk niet meer voorkomen door de where-filter
          continue;
        }
      } else {
        // nooit verkocht in gemeten periode → voor BF tellen we ze als idle
        idleDays = minIdleDays;
      }

      const languageCode: string = (bal.language ?? "EN").toString().toUpperCase();
      const languageCmId: number | null =
        LANGUAGE_TO_CM_ID[languageCode] ?? null;

      const condition: string = bal.condition ?? "NM";
      const isFoil: boolean = Boolean(bal.isFoil);
      const name: string | null = NAME_BY_CMID.get(cardmarketId) ?? null;

      rows.push({
        cardmarketId,
        name,
        isFoil,
        condition,
        languageCode,
        languageCmId,
        qty,
        oldPrice: basePrice,
        newPrice,
        discountPct,
        idleDays,
        cmLowEx,
        cmGermanProLow,
        ctMin,
        floorReason,
      });
    }

    if (format === "csv") {
      const csv = buildCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="idle-export-bf-${bfMode ? "bf" : "normal"}.csv"`,
        },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        bfMode,
        minIdleDays,
        floorRatio,
        minPrice,
        count: rows.length,
        rows,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Idle export error", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
