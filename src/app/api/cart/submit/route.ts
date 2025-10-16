export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendMail, customerConfirmationHtml, internalNewSubmissionHtml } from "@/lib/mail";
import { getPayoutPct } from "@/lib/config";

// ---- instellingen (alleen floor/cap hier) ----
const MIN_PAYOUT_EUR = 0.05;   // floor
const MAX_PAYOUT_EUR = 250;    // cap

type CondKey = "NMEX" | "GDLP";
const COND_MULT: Record<CondKey, number> = {
  NMEX: 1.0, // NM/EX
  GDLP: 0.9, // GD/LP → 10% minder
};

// Prisma Decimal → number
function decToNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = Number((v as any).toString?.() ?? v);
  return Number.isFinite(n) ? n : null;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: NextRequest) {
  try {
    const { email, items, meta } = await req.json();

    // ---- validatie ----
    if (!email || typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "E-mailadres vereist of ongeldig" }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: "Leeg mandje" }, { status: 400 });
    }

    // ---- payout% op de SERVER (snapshottable) ----
    // negeer client percent; gebruik env/config zodat de server leidend is
    const payoutPct = getPayoutPct();            // bv. 0.70
    const payoutPctInt = Math.round(payoutPct * 100); // bv. 70

    // ---- productIds verzamelen ----
    const ids = Array.from(
      new Set(
        items
          .map((i: any) => (typeof i?.idProduct === "number" || typeof i?.idProduct === "string" ? Number(i.idProduct) : NaN))
          .filter((n) => Number.isFinite(n))
      )
    ) as number[];

    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "Geen geldige idProduct waardes" }, { status: 400 });
    }

    // ---- trends ophalen (EUR, raw) ----
    const guides = await prisma.priceGuide.findMany({
      where: { productId: { in: ids }, isCurrent: true },
      select: { productId: true, trend: true, trendFoil: true },
    });

    const byId = new Map<number, { trend: number | null; trendFoil: number | null }>();
    for (const g of guides) {
      byId.set(g.productId as number, {
        trend: decToNum(g.trend),
        trendFoil: decToNum(g.trendFoil),
      });
    }

    // ---- serverberekening per regel ----
    type InItem = { idProduct: number | string; isFoil: boolean; qty: number; cond?: CondKey };
    const computed = (items as InItem[]).map((raw) => {
      const idProduct = Number(raw.idProduct);
      const isFoil = Boolean(raw.isFoil);
      const qty = Math.max(1, Number(raw.qty) || 1);
      const cond = (raw.cond ?? "NMEX") as CondKey;
      const condMult = COND_MULT[cond] ?? 1.0;

      const rec = byId.get(idProduct);
      const base = rec?.trend ?? 0; // non-foil
      const foil = rec?.trendFoil;  // foil kan null zijn
      const trend = isFoil ? (foil ?? base) : base; // EUR

      // unit = trend × server-payout × conditie
      let unit = round2((trend || 0) * payoutPct * condMult);
      if (unit < MIN_PAYOUT_EUR) unit = 0;
      if (unit > MAX_PAYOUT_EUR) unit = MAX_PAYOUT_EUR;

      const available = !!rec && (trend || 0) > 0 && unit >= MIN_PAYOUT_EUR;
      const line = round2(unit * qty);

      return {
        idProduct,
        isFoil,
        qty,
        cond,
        trend,              // EUR
        payoutPct,          // snapshot (0–1)
        condMult,           // snapshot
        unit,               // EUR
        lineCents: Math.round(line * 100),
        available,
      };
    });

    // alleen regels die we daadwerkelijk uitbetalen
    const filtered = computed.filter((r) => r.available && r.unit > 0);

    // totals (server-authoritative)
    const serverTotalCents = filtered.reduce((s, r) => s + r.lineCents, 0);
    const clientTotalCents = Math.round(Number(meta?.clientTotal ?? 0) * 100); // puur als referentie

    // ---- wegschrijven ----
    const submission = await prisma.submission.create({
  data: {
  email,
  payoutPct: payoutPctInt,              // bv. 70
  serverTotalCents,                     // authoritative (in cents)
  subtotalCents: serverTotalCents,      // <-- vereist door jouw schema
  items: {
    create: filtered.map((r) => ({
      productId: BigInt(r.idProduct),
      isFoil: r.isFoil,
      qty: r.qty,
      trendCents: r.trend != null ? Math.round(r.trend * 100) : null,
      unitCents: Math.round(r.unit * 100),
      lineCents: r.lineCents,
      cond: r.cond,
      condMult: r.condMult,
      payoutPct: payoutPctInt,
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


    // ---- mails (best-effort, met logging) ----
    const totalCents =
      Number(submission.serverTotalCents ?? 0) ||
      submission.items.reduce((s, i) => s + Number(i.lineCents ?? 0), 0);

    // klant
    try {
      await sendMail({
        to: submission.email,
        subject: "Buylist bevestigd – referentie " + submission.id,
        html: customerConfirmationHtml({
          submissionId: submission.id,
          email: submission.email,
          totalCents,
          items: submission.items.map((i) => {
            const label = `#${i.productId}${i.isFoil ? " (Foil)" : ""}`;
            return {
              name: label,
              qty: i.qty,
              unitCents: Number(i.unitCents ?? 0),
              lineCents: Number(i.lineCents ?? 0),
            };
          }),
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
        // geen 'to' meegeven → lib/mail.ts valt terug op MAIL_ADMIN/MAIL_FROM
        subject: "Buylist ontvangen – " + submission.id,
        html: internalNewSubmissionHtml({
          submissionId: submission.id,
          email: submission.email ?? "",
          totalCents,
          items: submission.items.map((i) => {
            const label = `#${i.productId}${i.isFoil ? " (Foil)" : ""}`;
            return {
              name: label,
              qty: i.qty,
              unitCents: Number(i.unitCents ?? 0),
              lineCents: Number(i.lineCents ?? 0),
            };
          }),
        }),
        replyTo: submission.email ?? undefined,
      });
      console.log("[submit] admin mail sent");
    } catch (e) {
      console.warn("[submit] admin mail failed (non-blocking):", e);
    }

    // ---- response ----
    return NextResponse.json(jsonSafe({ ok: true, submission }));
  } catch (e: any) {
    console.error("[submit] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal error" }, { status: 500 });
  }
}

// JSON helper (BigInt → number)
function jsonSafe<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}
