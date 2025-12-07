export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  sendMail,
  customerConfirmationHtml,
  internalNewSubmissionHtml,
} from "@/lib/mail";
import { getPayoutPct } from "@/lib/config";
import {
  computeUnitFromTrend,
  type CondKey,
} from "@/lib/buylistEngineCore";

// Prisma Decimal → number
function decToNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = Number((v as any).toString?.() ?? v);
  return Number.isFinite(n) ? n : null;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// Payload-conditie → CondKey (robust)
function mapCondFromPayload(raw: any): CondKey {
  const s = String(raw ?? "NM").toUpperCase().trim();

  if (s === "NM" || s === "EX" || s === "GD" || s === "LP" || s === "PL" || s === "PO") {
    return s as CondKey;
  }
  return "NM";
}

type InItem = {
  idProduct: number | string; // cardmarketId
  isFoil: boolean;
  qty: number;
  cond?: string;
};

export async function POST(req: NextRequest) {
  try {
    const { email, items, meta } = await req.json();

    // ---- validatie ----
    if (
      !email ||
      typeof email !== "string" ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    ) {
      return NextResponse.json(
        { ok: false, error: "E-mailadres vereist of ongeldig" },
        { status: 400 }
      );
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Leeg mandje" },
        { status: 400 }
      );
    }

    // payoutPct op Submission-niveau laten we bestaan (historisch),
    // maar per item rekenen we via de engine.
    const payoutPctEnv = getPayoutPct(); // bv. 0.70
    const payoutPctInt = Math.round(payoutPctEnv * 100);

    // ---- cardmarketIds verzamelen ----
    const ids = Array.from(
      new Set(
        items
          .map((i: any) =>
            typeof i?.idProduct === "number" ||
            typeof i?.idProduct === "string"
              ? Number(i.idProduct)
              : NaN
          )
          .filter((n) => Number.isFinite(n))
      )
    ) as number[];

    if (ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Geen geldige idProduct waardes" },
        { status: 400 }
      );
    }

    // ---- trends ophalen uit CMPriceGuide (EUR, raw) ----
    const guides = await prisma.cMPriceGuide.findMany({
      where: { cardmarketId: { in: ids } },
      select: { cardmarketId: true, trend: true, foilTrend: true },
    });

    // ---- eigen voorraad (InventoryBalance) aggregeren per cardmarketId ----
    const inv = await prisma.inventoryBalance.groupBy({
      where: { cardmarketId: { in: ids } },
      by: ["cardmarketId"],
      _sum: { qtyOnHand: true },
    });

    const ownQtyById = new Map<number, number>();
    for (const row of inv) {
      ownQtyById.set(row.cardmarketId as number, row._sum.qtyOnHand ?? 0);
    }

    const byId = new Map<
      number,
      { trend: number | null; trendFoil: number | null }
    >();
    for (const g of guides) {
      byId.set(g.cardmarketId as number, {
        trend: decToNum(g.trend),
        trendFoil: decToNum(g.foilTrend),
      });
    }

    // scryfallLookup-meta: tix / edhrecRank / gameChanger + naam/set
    const scryMeta = await prisma.scryfallLookup.findMany({
      where: { cardmarketId: { in: ids } },
      select: {
        cardmarketId: true,
        name: true,
        set: true,
        tix: true,
        edhrecRank: true,
        gameChanger: true,
        collectorNumber: true,
      },
    });

    const metaById = new Map<
      number,
      {
        name: string;
        set: string | null;
        collectorNumber: string | null;
        tix: number | null;
        edhrecRank: number | null;
        gameChanger: boolean | null;
      }
    >();

    for (const m of scryMeta) {
      metaById.set(m.cardmarketId as number, {
        name: m.name,
        set: m.set,
        collectorNumber: (m.collectorNumber as string | null) ?? null,
        tix: m.tix == null ? null : Number(m.tix),
        edhrecRank: (m.edhrecRank as number | null) ?? null,
        gameChanger: (m.gameChanger as boolean | null) ?? null,
      });
    }

       // ---- serverberekening per regel (engine + harde cap) ----

    // Per kaart bijhouden hoeveel we max willen hebben en hoeveel er al is
    const limitsById = new Map<number, { max: number; used: number }>();

    const computed = (items as InItem[]).map((raw) => {
      const idProduct = Number(raw.idProduct); // = cardmarketId
      const isFoil = Boolean(raw.isFoil);
      const requestedQty = Math.max(1, Number(raw.qty) || 1);

      const condKey = mapCondFromPayload(raw.cond);

      const rec = byId.get(idProduct);
      const trend = rec?.trend ?? null;
      const trendFoil = rec?.trendFoil ?? null;

      // kaart-specifieke meta (tix / edhrec / gameChanger)
      const meta = metaById.get(idProduct) ?? null;

      // eigen voorraad totaal (alle condities/foils samen)
      const ownQty = ownQtyById.get(idProduct) ?? 0;

      const { unit, pct, usedTrend, allowed } = computeUnitFromTrend({
        trend,
        trendFoil,
        isFoil,
        cond: condKey,
        ctx: {
          ownQty,
          edhrecRank: meta?.edhrecRank ?? null,
          mtgoTix: meta?.tix ?? null,
          gameChanger: meta?.gameChanger ?? null,
          // lowStock / recentSales14d kunnen we later vullen
        },
      });

      // Als de engine het al blokt (te lage prijs / conditie etc.)
      if (!allowed || !unit || unit <= 0) {
        return {
          idProduct,
          isFoil,
          collectorNumber: meta?.collectorNumber ?? null,
          qty: 0,
          condKey,
          trend,
          trendFoil,
          usedTrend,
          unit: 0,
          pct,
          lineCents: 0,
          allowed: false,
        };
      }

      // Harde cap:
      // - normale kaarten: max 8 totaal
      // - dure kaarten: max 4 totaal (op basis van gebruikte trend)
      const priceBasis = usedTrend ?? trend ?? 0;
      const baseMax = priceBasis >= 100 ? 4 : 8;

      let limit = limitsById.get(idProduct);
      if (!limit) {
        limit = {
          max: baseMax,
          used: ownQty, // dit hebben we al liggen
        };
        limitsById.set(idProduct, limit);
      }

      const remaining = Math.max(0, limit.max - limit.used);
      const acceptedQty = Math.max(
        0,
        Math.min(requestedQty, remaining)
      );

      // Niets meer over? Deze regel gaat de prullenbak in
      if (acceptedQty <= 0) {
        return {
          idProduct,
          isFoil,
          qty: 0,
          condKey,
          trend,
          trendFoil,
          usedTrend,
          unit: 0,
          pct,
          lineCents: 0,
          allowed: false,
        };
      }

      // Verbruik de hoeveelheid die we accepteren
      limit.used += acceptedQty;

      const safeUnit = unit;
      const line = round2(safeUnit * acceptedQty);

      return {
        idProduct,
        isFoil,
        collectorNumber: meta?.collectorNumber ?? null,
        qty: acceptedQty,           // 🔴 hier staat nu de "geknipte" qty
        condKey,
        trend,
        trendFoil,
        usedTrend,
        unit: safeUnit,             // EUR
        pct,                        // 0–1
        lineCents: Math.round(line * 100),
        allowed: true,
      };
    });

    // alleen regels die we daadwerkelijk uitbetalen
    const filtered = computed.filter((r) => r.allowed);



      
    const serverTotalCents = filtered.reduce(
      (s, r) => s + r.lineCents,
      0
    );
    const clientTotalCents = Math.round(
      Number(meta?.clientTotal ?? 0) * 100
    );

    // ---- wegschrijven ----
    const submission = await prisma.submission.create({
      data: {
        email,
        payoutPct: payoutPctInt,
        serverTotalCents,
        subtotalCents: serverTotalCents,
        items: {
          create: filtered.map((r) => ({
            productId: BigInt(r.idProduct), // we bewaren hier dus cardmarketId
            isFoil: r.isFoil,
            qty: r.qty,
            trendCents:
              r.usedTrend != null
                ? Math.round(r.usedTrend * 100)
                : r.trend != null
                ? Math.round(r.trend * 100)
                : null,
            trendFoilCents:
              r.trendFoil != null
                ? Math.round(r.trendFoil * 100)
                : null,
            unitCents: Math.round(r.unit * 100),
            lineCents: r.lineCents,
            pct: Math.round(r.pct * 100),
            collectorNumber: r.collectorNumber ?? null,
            cardName: metaById.get(r.idProduct)?.name ?? null,
            setCode: metaById.get(r.idProduct)?.set ?? null,
            condition: r.condKey,
          })),
        },
        metaText: JSON.stringify({
          clientTotalCents,
          itemsLength: items.length,
          receivedAt: new Date().toISOString(),
        }),
        currency: "EUR",
        pricingSource: "Cardmarket",
      },
      include: { items: true },
    });

    // ---- kaartnamen ophalen voor de mails (cardmarketId → name + set) ----
    const cmIdsForMail = Array.from(
      new Set(
        submission.items
          .map((i) => Number(i.productId))
          .filter((n) => Number.isFinite(n))
      )
    ) as number[];

    const lookups = cmIdsForMail.length
      ? await prisma.scryfallLookup.findMany({
          where: { cardmarketId: { in: cmIdsForMail } },
          select: { cardmarketId: true, name: true, set: true, collectorNumber: true, },
        })
      : [];

    const nameById = new Map<
  number,
  { name: string; set: string | null; collectorNumber: string | null }
>();
for (const r of lookups) {
  nameById.set(r.cardmarketId as number, {
    name: r.name,
    set: r.set,
    collectorNumber: (r.collectorNumber as string | null) ?? null,
  });
}

    // helper: sorteer items op set + naam en maak nette labels
function buildMailItems() {
  type WithMeta = {
    item: (typeof submission.items)[number];
    meta?: {
      name: string;
      set: string | null;
      collectorNumber: string | null; 
    };
  };

  const enriched: WithMeta[] = submission.items.map((item) => {
    const cmId = Number(item.productId);
    const meta = nameById.get(cmId);
    return { item, meta };
  });

  // sorteren op set (asc) en dan naam (asc)
  enriched.sort((a, b) => {
    const setA = (a.meta?.set || "").toUpperCase();
    const setB = (b.meta?.set || "").toUpperCase();
    if (setA < setB) return -1;
    if (setA > setB) return 1;

    const nameA = (a.meta?.name || "").toUpperCase();
    const nameB = (b.meta?.name || "").toUpperCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;

    return 0;
  });

  return enriched.map(({ item, meta }) => {
    const cmId = Number(item.productId);
    const base = meta
      ? `${meta.name}${
          meta.set ? ` [${meta.set.toUpperCase()}]` : ""
        }${meta.collectorNumber ? ` #${meta.collectorNumber}` : ""}`
      : `#${cmId}`;
    const label = `${base}${item.isFoil ? " (Foil)" : ""}`;

    return {
      name: label,
      qty: item.qty,
      unitCents: Number(item.unitCents ?? 0),
      lineCents: Number(item.lineCents ?? 0),
    };
  });
}


    const mailItems = buildMailItems();

    // ---- mails ----
    const totalCents =
      Number(submission.serverTotalCents ?? 0) ||
      submission.items.reduce(
        (s, i) => s + Number(i.lineCents ?? 0),
        0
      );

    // klant
    try {
      await sendMail({
        to: submission.email ?? undefined,
        subject: "Buylist bevestigd – referentie " + submission.id,
        html: customerConfirmationHtml({
          submissionId: submission.id,
          email: submission.email ?? "",
          totalCents,
          items: mailItems,
        }),
        replyTo: process.env.MAIL_ADMIN,
      });
      console.log("[submit] customer mail sent");
    } catch (e) {
      console.warn("[submit] customer mail failed (non-blocking):", e);
    }

    // admin
    try {
      await sendMail({
        subject: "Buylist ontvangen – " + submission.id,
        html: internalNewSubmissionHtml({
          submissionId: submission.id,
          email: submission.email ?? "",
          totalCents,
          items: mailItems,
        }),
        replyTo: submission.email ?? undefined,
      });
      console.log("[submit] admin mail sent");
    } catch (e) {
      console.warn("[submit] admin mail failed (non-blocking):", e);
    }

    return NextResponse.json(jsonSafe({ ok: true, submission }));
  } catch (e: any) {
    console.error("[submit] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 }
    );
  }
}

// JSON helper (BigInt → number)
function jsonSafe<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) =>
      typeof v === "bigint" ? Number(v) : v
    )
  );
}
