import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMarketplaceByBlueprint, normalizeCTZeroOffers } from "@/lib/ct";
import { summarizeByBucket } from "@/lib/ctStats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const bp = Number(sp.get("blueprintId") || 0);
  if (!bp) return NextResponse.json({ error: "blueprintId required" }, { status: 400 });

  // Optionele metadata
  const cm = sp.get("cardmarketId");
  const sf = sp.get("scryfallId");

  // ---- UI-achtige filters uit de query ----
  // zero: pro | probe | 0/none
  const zeroParam = (sp.get("zero") || "pro").toLowerCase();
  const zeroOnly = zeroParam !== "0" && zeroParam !== "none";
  const zeroMode: "pro" | "probe" | "none" =
    zeroParam === "probe" ? "probe" :
    zeroParam === "0" || zeroParam === "none" ? "none" : "pro";

  // cond: bv. "NM,EX" (default alle: NM/EX/GD)
  const condParam = (sp.get("cond") || "").toUpperCase().trim();
  const conds = condParam
    ? new Set(condParam.split(",").map(s => s.trim()).filter(Boolean))
    : new Set<"NM"|"EX"|"GD">(["NM","EX","GD"]);

  // lang: default EN
  const lang = (sp.get("lang") || "en").toLowerCase();

  // foil: 1 = alleen foil, 0 = alleen non-foil, leeg = beide
  const foilStr = sp.get("foil");
  const foil: boolean | null = foilStr === "1" ? true : foilStr === "0" ? false : null;

  // debug toggle
  const dbg = sp.get("debug") === "1";

  // ---- data ophalen ----
  const offers = await getMarketplaceByBlueprint(bp);

  if (dbg) {
    const sample = offers.slice(0, 8).map((o: any) => ({
      id: o.id,
      price_cents: o.price_cents ?? o?.price?.cents,
      condition: o.properties_hash?.condition ?? o.condition,
      lang: (o.properties_hash?.mtg_language ?? o.language ?? "").toLowerCase(),
      foil: !!(o.properties_hash?.mtg_foil ?? o.foil),
      user: { username: o.user?.username, user_type: o.user?.user_type }
    }));
    return NextResponse.json({
      blueprintId: bp,
      countOffers: offers.length,
      filters: { zeroOnly, zeroMode, conds: [...conds], lang, foil },
      sample
    });
  }

  // normaliseren + filteren o.b.v. query
  const norm = await normalizeCTZeroOffers(offers, {
    zeroOnly,
    zeroMode,
    zeroProbeLimit: 8,
    allowedConds: conds,
    lang,
    foil
  });

  // samenvatten in buckets (foil/non-foil)
  const rowsNF   = summarizeByBucket(norm, false);
  const rowsFoil = summarizeByBucket(norm, true);
  const now = new Date();

  // fetch mapping once for this blueprint
const map = await prisma.blueprintMapping.findUnique({
  where: { blueprintId: bp },
  select: { cardmarketId: true, scryfallId: true },
});

  // optioneel: opslag
  const writes = [...rowsNF, ...rowsFoil].map(r =>
    prisma.cTMarketSummary.upsert({
      where: {
        blueprintId_bucket_isFoil_capturedAt: {
          blueprintId: bp, bucket: r.bucket, isFoil: r.isFoil, capturedAt: now
        }
      },
      update: {},
      create: {
        capturedAt: now,
        blueprintId: bp,
        cardmarketId: map?.cardmarketId ?? null,
        scryfallId:   map?.scryfallId   ?? null,
        bucket: r.bucket,
        isFoil: r.isFoil,
        minPrice: r.min ?? null,
        medianPrice: r.med ?? null,
        offerCount: r.count,
      }
    })
  );
  await Promise.all(writes);

  return NextResponse.json({
    blueprintId: bp,
    capturedAt: now,
    summary: { nonFoil: rowsNF, foil: rowsFoil }
  });
}

