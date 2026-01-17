// src/app/api/admin/stock-policy/backfill-syp/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { StockClass } from "@prisma/client";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Regel: SYP hot (maxQty >= 10) => REGULAR, anders CTBULK
const HOT_THRESHOLD = 10;

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1"; // optional: force override van manual policies

    // 1) We hebben mapping nodig: ScryfallLookup (scryfallId, tcgplayerId)
    // tcgplayerId matcht met SypDemand.tcgProductId
    const lookups = await prisma.scryfallLookup.findMany({
      select: { scryfallId: true, tcgplayerId: true },
    });

    // 2) Maak set van tcgProductIds
    const tcgIds = Array.from(
      new Set(
        lookups
          .map((l) => l.tcgplayerId)
          .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      )
    );

    // 3) Haal SYP in bulk
    const sypRows = tcgIds.length
      ? await prisma.sypDemand.findMany({
          where: { tcgProductId: { in: tcgIds } },
          select: { tcgProductId: true, maxQty: true },
        })
      : [];

    const sypHotByTcg = new Map<number, boolean>();
    for (const r of sypRows) {
      const hot = Number(r.maxQty ?? 0) >= HOT_THRESHOLD;
      if (r.tcgProductId != null) sypHotByTcg.set(Number(r.tcgProductId), hot);
    }

    // 4) Huidige policies ophalen (zodat we netjes tellen/skippen)
    const scryIds = lookups.map((l) => l.scryfallId).filter(Boolean);
    const existingPolicies = scryIds.length
      ? await prisma.stockPolicy.findMany({
          where: { scryfallId: { in: scryIds } },
          select: { scryfallId: true, stockClass: true, sypHot: true },
        })
      : [];

    const polByScry = new Map(existingPolicies.map((p) => [p.scryfallId, p]));

    // 5) Build updates
    // Default: als geen tcgplayerId of geen syp row => NIET gokken => REGULAR (jouw stijl)
    const updates: Array<ReturnType<typeof prisma.stockPolicy.upsert>> = [];

    let wouldSetRegular = 0;
    let wouldSetCtb = 0;
    let changed = 0;
    let skippedManual = 0;

    for (const l of lookups) {
      const scryfallId = l.scryfallId;
      if (!scryfallId) continue;

      const hot =
        l.tcgplayerId != null ? (sypHotByTcg.get(Number(l.tcgplayerId)) ?? false) : false;

      // jouw no-guess policy: geen tcg id => REGULAR
      const stockClass: StockClass =
  l.tcgplayerId == null
    ? StockClass.REGULAR
    : hot
    ? StockClass.REGULAR
    : StockClass.CTBULK;


      if (stockClass === "REGULAR") wouldSetRegular++;
      else wouldSetCtb++;

      const prev = polByScry.get(scryfallId);

      // Als je “manual overrides” wil respecteren:
      // force=0 => alleen corrigeren als prev stockClass niet (REGULAR/CTBULK) is, of sypHot mismatch
      if (!force && prev?.stockClass && (prev.stockClass === "REGULAR" || prev.stockClass === "CTBULK")) {
        const same = String(prev.stockClass) === stockClass && Boolean(prev.sypHot) === Boolean(hot);
        if (same) continue;
        // als iemand handmatig stockClass zette, dan zou dit het overschrijven; als je dat niet wil:
        // -> behandel als manual en skip
        skippedManual++;
        continue;
      }

      // als force=1, dan always set
      if (prev) {
        const same = String(prev.stockClass) === stockClass && Boolean(prev.sypHot) === Boolean(hot);
        if (same) continue;
      }

      changed++;

      updates.push(
        prisma.stockPolicy.upsert({
          where: { scryfallId },
          create: { scryfallId, stockClass: stockClass as any, sypHot: hot },
          update: { stockClass: stockClass as any, sypHot: hot },
        })
      );
    }

    // 6) Apply in transaction (chunken is netter, maar dit is ok zolang het niet gigantisch is)
    // Als je heel veel kaarten hebt, kun je later chunking toevoegen.
    if (updates.length) {
      await prisma.$transaction(updates);
    }

    return NextResponse.json({
      ok: true,
      hotThreshold: HOT_THRESHOLD,
      totalLookups: lookups.length,
      sypRows: sypRows.length,
      wouldSetRegular,
      wouldSetCtb,
      changed,
      skippedManual,
      force,
    });
  } catch (e: any) {
    console.error("backfill-syp error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
