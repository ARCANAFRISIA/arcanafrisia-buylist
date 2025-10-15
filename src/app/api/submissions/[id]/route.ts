import { NextResponse } from "next/server";
import { PrismaClient, SubmissionStatus } from "@prisma/client";
import { sendMail, euro } from "@/lib/mail";

function jsonSafe<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

const prisma = new PrismaClient();

// Pas eventueel de lijst aan als je "GRADING" al in je Prisma enum hebt.
const ALLOWED: SubmissionStatus[] = ["RECEIVED", "CONFIRMED", "PAID"]; // of ["RECEIVED","CONFIRMED","GRADING","PAID"]

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const status = String(body?.status) as SubmissionStatus;

    if (!ALLOWED.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const updated = await prisma.submission.update({
      where: { id },
      data: { status },
      include: { items: true },
    });

    // ——— Mail (non-blocking) ———
    (async () => {
      try {
        const totalCents =
          Number(updated.serverTotalCents ?? 0) ||
          updated.items.reduce((s, i) => s + Number(i.lineCents ?? 0), 0);

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
              <p><b>Bedrag:</b> ${euro(totalCents)}</p>
              <p>Je ontvangt een aparte bevestiging zodra de betaling is uitgevoerd.</p>
            `
            : status === "PAID"
            ? `
              <p>Je betaling is zojuist verzonden.</p>
              <p><b>Bedrag:</b> ${euro(totalCents)}</p>
              <p>Afhankelijk van je bank kan het 1–2 werkdagen duren voordat het zichtbaar is.</p>
            `
            : `
              <p>Je buylist status is gewijzigd naar <b>${status}</b>.</p>
              <p><b>Indicatief totaal:</b> ${euro(totalCents)}</p>
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
