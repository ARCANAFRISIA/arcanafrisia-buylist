import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computePayoutCmix } from "@/utils/pricing";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("cardmarketId"));
    const isFoil = searchParams.get("foil") === "1";

    if (!id) {
      return NextResponse.json({ error: "cardmarketId required" }, { status: 400 });
    }

    // 1) CM record (mag ontbreken)
    const cm = await prisma.cMPriceGuide.findUnique({
      where: { cardmarketId: id },
    });

    // 2) CT min price (niet unique -> findFirst, liefst met foil, anders zonder)
    let ctMinPrice: number | null = null;

    // probeer exact foil match eerst
    const ctExact = await prisma.cTMarketLatest.findFirst({
      where: { cardmarketId: id, isFoil },
      orderBy: { capturedAt: "desc" },
      select: { minPrice: true },
    });

    if (ctExact?.minPrice != null) {
      ctMinPrice = ctExact.minPrice;
    } else {
      // fallback: neem welke er is
      const ctAny = await prisma.cTMarketLatest.findFirst({
        where: { cardmarketId: id },
        orderBy: { capturedAt: "desc" },
        select: { minPrice: true },
      });
      ctMinPrice = ctAny?.minPrice ?? null;
    }

    // als zowel CM als CT ontbreken, geef dan 0 terug
    if (!cm && ctMinPrice == null) {
      return NextResponse.json({ id, isFoil, payout: 0, source: "none" });
    }

    const payout = computePayoutCmix({
      cm: cm ?? {
        trend: null, foilTrend: null, lowEx: null, suggested: null,
        germanProLow: null, avg7: null, avg30: null, foilAvg7: null, foilAvg30: null
      },
      ctMinPrice,
      isFoil,
    });

 const sf = await prisma.scryfallLookup.findUnique({
      where: { cardmarketId: id },
      select: {
        name: true,
        set: true,
        collectorNumber: true,
        imageSmall: true,
        imageNormal: true,
      },
    });

    return NextResponse.json({
      id,
      isFoil,
      payout,
      inputs: {
        cmTrend: isFoil ? cm?.foilTrend ?? null : cm?.trend ?? null,
        cmLowEx: cm?.lowEx ?? null,
        ctMinPrice,
        avg7: isFoil ? cm?.foilAvg7 ?? null : cm?.avg7 ?? null,
        avg30: isFoil ? cm?.foilAvg30 ?? null : cm?.avg30 ?? null,
      },
       scryfall: sf ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "internal error" }, { status: 500 });
  }
}
