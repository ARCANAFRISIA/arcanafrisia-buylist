// src/app/api/cart/submit/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPendingQtyByCardmarketId } from "@/lib/buylistPending";

import {
  sendMail,
  customerConfirmationHtml,
  internalNewSubmissionHtml,
} from "@/lib/mail";
import { getPayoutPct } from "@/lib/config";
import { computeUnitFromTrend, type CondKey } from "@/lib/buylistEngineCore";

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
  if (
    s === "NM" ||
    s === "EX" ||
    s === "GD" ||
    s === "LP" ||
    s === "PL" ||
    s === "PO"
  ) {
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

type InMeta = {
  clientTotal?: number;
  shippingMethod?: string;
};

type InBody = {
  email: string;
  fullName?: string;
  addressLine1?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  payoutMethod?: string;
  iban?: string;
  paypalEmail?: string;
  items: InItem[];
  meta?: InMeta;
};

// ---- SYP cap rules ----
const DEFAULT_TARGET_IF_NO_SYP = 2;

// jouw regel: 100 -> 10, 20 -> 2, 28 -> 2, 0/unknown -> 2
function computeTargetFromMaxQty(maxQty: number | null | undefined): number {
  if (maxQty == null) return DEFAULT_TARGET_IF_NO_SYP;
  const mq = Number(maxQty);
  if (!Number.isFinite(mq) || mq <= 0) return DEFAULT_TARGET_IF_NO_SYP;
  const t = Math.floor(mq / 10);
  return t > 0 ? t : DEFAULT_TARGET_IF_NO_SYP;
}

export async function POST(req: NextRequest) {
  try {
    const body: InBody = await req.json();

    const {
      email,
      fullName,
      addressLine1,
      postalCode,
      city,
      country,
      payoutMethod,
      iban,
      paypalEmail,
      items,
      meta,
    } = body;

    // ---- validatie ----
    if (!fullName || !fullName.trim()) {
      return NextResponse.json(
        { ok: false, error: "Naam is vereist" },
        { status: 400 }
      );
    }
    if (!addressLine1 || !postalCode || !city || !country) {
      return NextResponse.json(
        { ok: false, error: "Volledig adres is vereist" },
        { status: 400 }
      );
    }

    if (!payoutMethod) {
      return NextResponse.json(
        { ok: false, error: "Betaalmethode is vereist" },
        { status: 400 }
      );
    }

    if (payoutMethod === "BANK") {
      if (!iban || !iban.trim()) {
        return NextResponse.json(
          { ok: false, error: "IBAN is vereist voor bankoverschrijving" },
          { status: 400 }
        );
      }
    } else if (payoutMethod === "PAYPAL") {
      if (!paypalEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(paypalEmail)) {
        return NextResponse.json(
          { ok: false, error: "Geldig PayPal e-mailadres is vereist" },
          { status: 400 }
        );
      }
    }

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

    // payoutPct op Submission-niveau laten we bestaan (historisch)
    const payoutPctEnv = getPayoutPct(); // bv. 0.70
    const payoutPctInt = Math.round(payoutPctEnv * 100);

    // ---- cardmarketIds verzamelen ----
    const ids = Array.from(
      new Set(
        items
          .map((i: any) =>
            typeof i?.idProduct === "number" || typeof i?.idProduct === "string"
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

    const byId = new Map<number, { trend: number | null; trendFoil: number | null }>();
    for (const g of guides) {
      byId.set(g.cardmarketId as number, {
        trend: decToNum(g.trend),
        trendFoil: decToNum(g.foilTrend),
      });
    }

    // ---- eigen voorraad (InventoryBalance) aggregeren per cardmarketId ----
    const inv = await prisma.inventoryBalance.groupBy({
      where: { cardmarketId: { in: ids } },
      by: ["cardmarketId"],
      _sum: { qtyOnHand: true },
    });

    const ownOnHandById = new Map<number, number>();
    for (const row of inv) {
      ownOnHandById.set(row.cardmarketId as number, row._sum.qtyOnHand ?? 0);
    }

    // ---- pending qty (submissions in flight) ----
    const pendingById = await getPendingQtyByCardmarketId(ids);

    // ---- scryfallLookup meta (tcgplayerId / tix / edh / gameChanger + naam/set) ----
    const scryMeta = await prisma.scryfallLookup.findMany({
      where: { cardmarketId: { in: ids } },
      select: {
        cardmarketId: true,
        tcgplayerId: true,
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

    const tcgByCmId = new Map<number, number | null>();
    const tcgIds: number[] = [];

    for (const m of scryMeta) {
      metaById.set(m.cardmarketId as number, {
        name: m.name,
        set: m.set,
        collectorNumber: (m.collectorNumber as string | null) ?? null,
        tix: m.tix == null ? null : Number(m.tix),
        edhrecRank: (m.edhrecRank as number | null) ?? null,
        gameChanger: (m.gameChanger as boolean | null) ?? null,
      });

      const tcg = m.tcgplayerId == null ? null : Number(m.tcgplayerId);
      tcgByCmId.set(m.cardmarketId as number, tcg);
      if (tcg != null && Number.isFinite(tcg)) tcgIds.push(tcg);
    }

    // ---- SYP maxQty ophalen: meerdere rows per tcgProductId -> pak MAX(maxQty) ----
    const uniqueTcgIds = Array.from(new Set(tcgIds));

    const sypRows = uniqueTcgIds.length
      ? await prisma.sypDemand.findMany({
          where: { tcgProductId: { in: uniqueTcgIds } },
          select: { tcgProductId: true, maxQty: true },
        })
      : [];

    const sypMaxByTcg = new Map<number, number>();
    for (const r of sypRows) {
      const id = Number(r.tcgProductId);
      if (!Number.isFinite(id)) continue;

      const mq = Number(r.maxQty ?? 0);
      const prev = sypMaxByTcg.get(id);
      if (prev == null || mq > prev) sypMaxByTcg.set(id, mq);
    }

    // ---- serverberekening per regel (engine + SYP cap) ----
    // We cappen per cardmarketId (jouw buylist werkt op CM id)
    const limitsByCmId = new Map<number, { target: number; used: number }>();

    const computed = (items as InItem[]).map((raw) => {
      const cmId = Number(raw.idProduct);
      const isFoil = Boolean(raw.isFoil);
      const requestedQty = Math.max(1, Number(raw.qty) || 1);
      const condKey = mapCondFromPayload(raw.cond);

      const trends = byId.get(cmId);
      const trend = trends?.trend ?? null;
      const trendFoil = trends?.trendFoil ?? null;

      const meta = metaById.get(cmId) ?? null;

      const ownOnHand = ownOnHandById.get(cmId) ?? 0;
      const pending = pendingById.get(cmId) ?? 0;
      const ownTotal = ownOnHand + pending;

      // prijs/allowed via engine
      const { unit, pct, usedTrend, allowed } = computeUnitFromTrend({
        trend,
        trendFoil,
        isFoil,
        cond: condKey,
        ctx: {
          // engine overstock check baseer je op fysieke voorraad (onHand),
          // SYP-cap doen wij op ownTotal (incl pending)
          ownQty: ownOnHand,
          edhrecRank: meta?.edhrecRank ?? null,
          mtgoTix: meta?.tix ?? null,
          gameChanger: meta?.gameChanger ?? null,
        },
      });

      if (!allowed || !unit || unit <= 0) {
        return {
          cmId,
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
          debug: { target: 0, maxQty: null as number | null, ownOnHand, pending },
        };
      }

      const tcg = tcgByCmId.get(cmId) ?? null;
      const maxQty = tcg != null ? (sypMaxByTcg.get(tcg) ?? null) : null;
      const target = computeTargetFromMaxQty(maxQty);

      let lim = limitsByCmId.get(cmId);
      if (!lim) {
        lim = { target, used: ownTotal };
        limitsByCmId.set(cmId, lim);
      } else {
        // voor veiligheid: als target hoger uitkomt, neem max
        if (target > lim.target) lim.target = target;
      }

      const remaining = Math.max(0, lim.target - lim.used);
      const acceptedQty = Math.max(0, Math.min(requestedQty, remaining));

      if (acceptedQty <= 0) {
        return {
          cmId,
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
          debug: { target: lim.target, maxQty, ownOnHand, pending },
        };
      }

      lim.used += acceptedQty;

      const line = round2(unit * acceptedQty);

      return {
        cmId,
        isFoil,
        collectorNumber: meta?.collectorNumber ?? null,
        qty: acceptedQty,
        condKey,
        trend,
        trendFoil,
        usedTrend,
        unit,
        pct,
        lineCents: Math.round(line * 100),
        allowed: true,
        debug: { target: lim.target, maxQty, ownOnHand, pending },
      };
    });

    const filtered = computed.filter((r) => r.allowed);

    if (!filtered.length) {
      return NextResponse.json(
        { ok: false, error: "Geen items (meer) buyable na server checks / caps" },
        { status: 400 }
      );
    }

    const shippingMethodRaw = meta?.shippingMethod;
    const shippingMethod: "SELF" | "LABEL" =
      shippingMethodRaw === "LABEL" ? "LABEL" : "SELF";

    const serverTotalCents = filtered.reduce((s, r) => s + r.lineCents, 0);
    const clientTotalCents = Math.round(Number(meta?.clientTotal ?? 0) * 100);

    const labelFree =
      shippingMethod === "LABEL" && serverTotalCents >= 15000; // €150

    // ---- wegschrijven ----
    const submission = await prisma.submission.create({
      data: {
        email,
        fullName: fullName || null,
        addressLine1: addressLine1 || null,
        postalCode: postalCode || null,
        city: city || null,
        country: country || null,
        payoutMethod: payoutMethod || null,
        iban: iban || null,
        paypalEmail: paypalEmail || null,
        shippingMethod,

        payoutPct: payoutPctInt,
        serverTotalCents,
        subtotalCents: serverTotalCents,
        items: {
          create: filtered.map((r) => ({
            productId: BigInt(r.cmId), // productId stores cardmarketId
            isFoil: r.isFoil,
            qty: r.qty,
            trendCents:
              r.usedTrend != null
                ? Math.round(r.usedTrend * 100)
                : r.trend != null
                ? Math.round(r.trend * 100)
                : null,
            trendFoilCents:
              r.trendFoil != null ? Math.round(r.trendFoil * 100) : null,
            unitCents: Math.round(r.unit * 100),
            lineCents: r.lineCents,
            pct: Math.round(r.pct * 100),
            collectorNumber: r.collectorNumber ?? null,
            cardName: metaById.get(r.cmId)?.name ?? null,
            setCode: metaById.get(r.cmId)?.set ?? null,
            condition: r.condKey,
          })),
        },
        metaText: JSON.stringify({
          clientTotalCents,
          itemsLength: items.length,
          receivedAt: new Date().toISOString(),
          shippingMethod,
          labelFree,
          // klein debugspoor (handig als iemand “waarom knip je mijn qty”)
          caps: filtered.slice(0, 80).map((r) => ({
            cardmarketId: r.cmId,
            target: r.debug.target,
            maxQty: r.debug.maxQty,
            onHand: r.debug.ownOnHand,
            pending: r.debug.pending,
          })),
        }),
        currency: "EUR",
        pricingSource: "Cardmarket",
      },
      include: { items: true },
    });

    // ---- kaartnamen ophalen voor de mails ----
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
          select: { cardmarketId: true, name: true, set: true, collectorNumber: true },
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

    function buildMailItems() {
      type WithMeta = {
        item: (typeof submission.items)[number];
        meta?: { name: string; set: string | null; collectorNumber: string | null };
      };

      const enriched: WithMeta[] = submission.items.map((item) => {
        const cmId = Number(item.productId);
        const meta = nameById.get(cmId);
        return { item, meta };
      });

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
          ? `${meta.name}${meta.set ? ` [${meta.set.toUpperCase()}]` : ""}${
              meta.collectorNumber ? ` #${meta.collectorNumber}` : ""
            }`
          : `#${cmId}`;

        const details: string[] = [];
        if (item.condition) details.push(String(item.condition));
        if (item.isFoil) details.push("Foil");

        const suffix = details.length ? ` • ${details.join(" • ")}` : "";
        const label = `${base}${suffix}`;

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
      submission.items.reduce((s, i) => s + Number(i.lineCents ?? 0), 0);

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
          shippingMethod,
          labelFree,
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
          shippingMethod,
          labelFree,
          fullName,
          addressLine1,
          postalCode,
          city,
          country,
          payoutMethod,
          iban,
          paypalEmail,
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
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}
