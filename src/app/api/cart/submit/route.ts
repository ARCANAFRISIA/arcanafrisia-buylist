export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendMail, customerConfirmationHtml, internalNewSubmissionHtml } from "@/lib/mail"; // ⬅️ nieuw

const DEFAULT_PCT = 60;        // %
const MIN_PAYOUT_EUR = 0.05;   // floor
const MAX_PAYOUT_EUR = 250;    // cap

export async function POST(req: NextRequest) {
  try {
    const { email, items, meta } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ ok: false, error: "E-mailadres vereist" }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: "Leeg mandje" }, { status: 400 });
    }

    const pct = Number(meta?.percent ?? DEFAULT_PCT);
    const factor = (Number.isFinite(pct) && pct > 0 ? pct : DEFAULT_PCT) / 100;

    const ids = Array.from(
      new Set(items.map((i: any) => Number(i.idProduct)).filter(Number.isInteger))
    );

    const guides = await prisma.priceGuide.findMany({
      where: { productId: { in: ids }, isCurrent: true },
    });
    const byId = new Map<number, (typeof guides)[number]>();
    for (const g of guides) byId.set(g.productId as number, g);

    const pricedItems = items.map((it: any) => {
      const idProduct = Number(it.idProduct);
      const isFoil = Boolean(it.isFoil);
      const qty = Math.max(1, Number(it.qty) || 1);

      const g = byId.get(idProduct);
      const base = Number(g?.trend ?? 0);
      const foilSpecific = g?.trendFoil == null ? null : Number(g.trendFoil);
      const trend = isFoil ? (foilSpecific ?? base) : base;

      let unit = round2(trend * factor);
      if (unit < MIN_PAYOUT_EUR) unit = 0;
      if (unit > MAX_PAYOUT_EUR) unit = MAX_PAYOUT_EUR;

      const available = !!g && trend > 0 && unit >= MIN_PAYOUT_EUR;
      const lineTotal = round2(unit * qty);

      return { idProduct, isFoil, qty, unit, available, trend, pct, lineTotal };
    });

    // Alleen regels die we daadwerkelijk uitbetalen
    const filtered = pricedItems.filter((r) => r.available && r.unit > 0);

    // totals
    const serverTotal = round2(filtered.reduce((s, r) => s + r.unit * r.qty, 0));
    const serverTotalCents = Math.round(serverTotal * 100);
    const clientTotalCents = Math.round(Number(meta?.clientTotal ?? 0) * 100);
    const payoutPctInt = Math.round(Number(pct)); // bv. 60/67/70

    const submission = await prisma.submission.create({
      data: {
        email,
        subtotalCents: serverTotalCents,
        serverTotalCents,
        clientTotalCents,
        payoutPct: payoutPctInt,
        currency: "EUR",
        pricingSource: "Cardmarket",
        metaText: JSON.stringify({ requestedPercent: meta?.percent ?? pct }), // JSON als tekst
        items: {
          create: filtered.map((r) => ({
            productId: BigInt(r.idProduct),
            isFoil: r.isFoil,
            qty: r.qty,
            trendCents: r.trend != null ? Math.round(Number(r.trend) * 100) : null,
            trendFoilCents:
              r.isFoil && r.trend != null ? Math.round(Number(r.trend) * 100) : null,
            unitCents: Math.round(r.unit * 100),
            lineCents: Math.round(r.unit * r.qty * 100),
            pct: payoutPctInt,
          })),
        },
      },
      include: { items: true },
    });

    // --- MAILS: non-blocking, best-effort ---
    // fallback totaal (voor het geval totalCents ooit null is)
    const totalCents =
      Number(submission.serverTotalCents ?? 0) ||
      submission.items.reduce((s, i) => s + Number(i.lineCents ?? 0), 0);

    (async () => {
      try {
        // klantbevestiging
      if (submission.email) {
        await sendMail({
          to: submission.email,
          subject: "Buylist ontvangen – referentie " + submission.id,
          html: customerConfirmationHtml({
            submissionId: submission.id,
            email: submission.email,
            totalCents,
            items: submission.items.map((i) => ({
  name: i.name ?? `#${i.productId}${i.isFoil ? " (Foil)" : ""}`,
  qty: i.qty,
  unitCents: Number(i.unitCents ?? 0),
  lineCents: Number(i.lineCents ?? 0),
})),

          }),
          replyTo: process.env.MAIL_ADMIN, // handig als klant replyt
        });
} else {
  // optioneel: loggen zodat je weet dat klantmail is geskipped
  console.log("No customer email present; skipping confirmation for submission", submission.id);
}
        // interne notificatie
        const adminTo =
          process.env.MAIL_ADMIN && process.env.MAIL_ADMIN.length > 3
            ? process.env.MAIL_ADMIN
            : submission.email; // dev-fallback zodat je iets ziet

        await sendMail({
          to: adminTo,
          subject: "Nieuwe buylist: " + submission.id,
          html: internalNewSubmissionHtml({
            submissionId: submission.id,
            email: submission.email,
            totalCents,
            items: submission.items.map((i) => ({
  name: i.name ?? `#${i.productId}${i.isFoil ? " (Foil)" : ""}`,
  qty: i.qty,
  unitCents: Number(i.unitCents ?? 0),
  lineCents: Number(i.lineCents ?? 0),
})),

          }),
        });
      } catch (err) {
        console.error("Mail sending failed (non-blocking):", err);
      }
    })();
    // --- EINDE MAILS ---

    const payload = jsonSafe({ ok: true, submission });
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function jsonSafe<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}
