import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendMail, euro } from "@/lib/mail";

type SubmissionStatus = "RECEIVED" | "CONFIRMED" | "PAID";
const isValidStatus = (s: string): s is SubmissionStatus =>
  s === "RECEIVED" || s === "CONFIRMED" || s === "PAID";


function jsonSafe<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const statusRaw = String(body?.status ?? "");

    if (!isValidStatus(statusRaw)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const status: SubmissionStatus = statusRaw;

    const updated = await prisma.submission.update({
      where: { id: params.id },
      data: { status },
      include: { items: true }, // nodig voor totals / mails
    });

    // ——— Mail (non-blocking) ———
    (async () => {
      try {
        const subtotalCents =
      (("subtotalCents" in updated) &&
        typeof (updated as any).subtotalCents === "number" &&
        (updated as any).subtotalCents) ||
      updated.items.reduce((s, i) => s + (i.lineCents ?? 0), 0);

        const subject =
          status === "CONFIRMED"
            ? `Buylist bevestigd – ${updated.id}`
            : status === "PAID"
            ? `Betaling verzonden – ${updated.id}`
            : `Status update – ${updated.id}`;

        const bodyHtml =
          status === "CONFIRMED"
            ? `
              <p>We hebben je buylist gecontroleerd en bevestigd.</p>
              <p><b>Bedrag:</b> ${euro(subtotalCents)}</p>
              <p>Je ontvangt een aparte bevestiging zodra de betaling is uitgevoerd.</p>
            `
            : status === "PAID"
            ? `
              <p>Je betaling is zojuist verzonden.</p>
              <p><b>Bedrag:</b> ${euro(subtotalCents)}</p>
              <p>Afhankelijk van je bank kan het 1–2 werkdagen duren voordat het zichtbaar is.</p>
            `
            : `
              <p>Je buylist status is gewijzigd naar <b>${status}</b>.</p>
              <p><b>Indicatief totaal:</b> ${euro(subtotalCents)}</p>
            `;

        await sendMail({
          to: updated.email,
          subject,
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;line-height:1.5;">
              <h2>${subject}</h2>
              <p><b>Referentie:</b> ${updated.id}</p>
              ${bodyHtml}
              <p>Groet,<br/>Arcana Frisia</p>
            </div>
          `,
        });
      } catch (e) {
        console.error("status-change mail failed:", e);
      }
    })();
    // ——— Einde mail ———

    return NextResponse.json(jsonSafe({ ok: true, submission: updated }));
  } catch (err: any) {
    console.error("PUT /api/submissions/[id] error:", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!submission) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(jsonSafe(submission));
}
