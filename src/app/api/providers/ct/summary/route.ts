import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMarketplaceByBlueprint, normalizeCTZeroOffers } from "@/lib/ct";
import { summarizeByBucket } from "@/lib/ctStats";

export const dynamic = "force-dynamic";

type Cond = "NM" | "EX" | "GD";
const isCond = (x: string): x is Cond => x === "NM" || x === "EX" || x === "GD";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const bp = Number(sp.get("blueprintId") || 0);
  if (!bp) return NextResponse.json({ error: "blueprintId required" }, { status: 400 });

  // Optionele metadata (nu ongebruikt → underscore voorkomt lint errors)
  const _cm = sp.get("cardmarketId");
  const _sf = sp.get("scryfallId");

  // ---- UI-achtige filters uit de query ----
  // zero: pro | probe | 0/none
  const zeroParam = (sp.get("zero") || "pro").toLowerCase();
  const zeroOnly = zeroParam !== "0" && zeroParam !== "none";
  const zeroMode: "pro" | "probe" | "none" =
    zeroParam === "probe" ? "probe" :
    zeroParam === "0" || zeroParam === "none" ? "none" : "pro";

  // cond: bv. "NM,EX" (default alle: NM/EX/GD)  → altijd Array<'NM'|'EX'|'GD'>
  const condParam = (sp.get("cond") || "").toUpperCase().trim();
  const allowedConds: Cond[] = condParam
    ? Array.from(new Set(
        condParam.split(",").map(s => s.trim()).filter(Boolean)
      )).filter(isCond)
    : (["NM", "EX", "GD"] as Cond[]);

  // lang: default EN (type sluit aan op CTMarketOptions)
  const langParam = (sp.get("lang") || "en").toLowerCase();
  const lang: "en" | null = langParam === "en" ? "en" : null;

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
      filters: { zeroOnly, zeroMode, conds: allowedConds, lang, foil },
      sample
    });
  }

  // normaliseren + filteren o.b.v. query
  const norm = await normalizeCTZeroOffers(offers, {
    zeroOnly,
    zeroMode,
    zeroProbeLimit: 8,
    allowedConds,   // ✅ Array<'NM'|'EX'|'GD'>
    lang,           // ✅ 'en' | null
    foil            // ✅ boolean | null
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
