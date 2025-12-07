export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendMail, euro } from "@/lib/mail";

const ALLOWED = new Set(["SUBMITTED","RECEIVED","GRADING","ADJUSTED","APPROVED","REJECTED","PAID"]);

function appendEvent(metaText: string | null | undefined, evt: any): string {
  let arr: any[] = [];
  try { if (metaText) arr = JSON.parse(metaText); } catch {}
  if (!Array.isArray(arr)) arr = [];
  arr.push({ ts: new Date().toISOString(), ...evt });
  return JSON.stringify(arr);
}

// ✅ JSON helper: BigInt -> Number
function jsonSafe<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const status = String(body?.status || "").toUpperCase();
    const message: string | undefined = body?.message || undefined;

    if (!ALLOWED.has(status)) {
      return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
    }

    const cur = await prisma.submission.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!cur) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const nextMeta = appendEvent(cur.metaText ?? null, {
      type: "status",
      from: cur.status,
      to: status,
      message: message ?? null,
    });

    const updated = await prisma.submission.update({
      where: { id },
      data: { status, metaText: nextMeta },
      include: { items: true },
    });

    // klantmail (best-effort)
    (async () => {
      try {
        if (!updated.email) return;
        const totalCents =
          Number(updated.serverTotalCents ?? 0) ||
          updated.items.reduce((s, i) => s + Number(i.lineCents ?? 0), 0);

        const subjectMap: Record<string,string> = {
          SUBMITTED: `Buylist ingediend – ${updated.id}`,
          RECEIVED: `We hebben je buylist ontvangen – ${updated.id}`,
          GRADING:  `We beoordelen je kaarten – ${updated.id}`,
          ADJUSTED: `Prijs aangepast – ${updated.id}`,
          APPROVED: `Goedgekeurd – ${updated.id}`,
          REJECTED: `Afgekeurd – ${updated.id}`,
          PAID:     `Uitbetaald – ${updated.id}`,
        };
        const bodyMap: Record<string,string> = {
          SUBMITTED: `<p>Je buylist is ingediend. Zodra we je kaarten fysiek ontvangen, updaten we de status.<br/>Referentie: <strong>${updated.id}</strong>.</p>`,
          RECEIVED: `<p>Bedankt! We hebben je buylist ontvangen. Referentie: <strong>${updated.id}</strong>.<br/>Totaal (indicatief): <strong>${euro(totalCents)}</strong>.</p>`,
          GRADING:  `<p>We zijn je kaarten aan het beoordelen (conditie/telling). Referentie: <strong>${updated.id}</strong>.</p>`,
          ADJUSTED: `<p>We hebben je totaal aangepast. ${message ? `Toelichting: ${message}` : ""}<br/>Nieuw totaal (indicatief): <strong>${euro(totalCents)}</strong>.</p>`,
          APPROVED: `<p>Je buylist is goedgekeurd. Totaal: <strong>${euro(totalCents)}</strong>.<br/>We gaan door naar uitbetaling.</p>`,
          REJECTED: `<p>Helaas is je buylist afgekeurd.${message ? ` Reden: ${message}` : ""}</p>`,
          PAID:     `<p>We hebben uitbetaald. Bedrag: <strong>${euro(totalCents)}</strong>.${message ? ` Opmerking: ${message}` : ""}</p>`,
        };

        await sendMail({
          to: updated.email ?? undefined,
          subject: subjectMap[status] ?? `Statusupdate – ${updated.id}`,
          html: bodyMap[status] ?? `<p>Status: <strong>${status}</strong></p>`,
          replyTo: process.env.MAIL_ADMIN,
        });
      } catch (e) {
        console.warn("[status] customer mail failed:", e);
      }
    })();

    // ⬅️ BigInt-vrije JSON teruggeven
    return NextResponse.json(jsonSafe({ ok: true, submission: updated }));
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
