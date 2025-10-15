import { Resend } from "resend";

type MailPayload = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | string[];
};

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "Buylist <no-reply@localhost>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export async function sendMail(payload: MailPayload) {
  if (!resend) {
    console.log("-".repeat(60));
    console.log("MAIL (DEV LOG) to:", Array.isArray(payload.to) ? payload.to.join(", ") : payload.to);
    console.log("SUBJECT:", payload.subject);
    console.log("FROM:", MAIL_FROM);
    if (payload.replyTo) console.log("REPLY-TO:", payload.replyTo);
    console.log("HTML\n", payload.html);
    console.log("-".repeat(60));
    return { ok: true, id: "dev-log" };
  }

  const result = await resend.emails.send({
    from: MAIL_FROM,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    replyTo: payload.replyTo,   // 👈 fix
  });

  if ((result as any)?.error) throw new Error((result as any).error.message);
  return { ok: true, id: (result as any)?.data?.id || "" };
}

export const euro = (cents: number) =>
  (cents / 100).toLocaleString("nl-NL", { style: "currency", currency: "EUR" });


/* --------- Templates --------- */

type LineItem = {
  name: string;
  qty: number;
  unitCents?: number | null;
  lineCents?: number | null;
};



export function renderItemsTable(items: LineItem[]) {
  const rows = items
    .map((i) => {
      const unit = Number(i.unitCents ?? 0);
      const line = Number(i.lineCents ?? i.qty * unit);
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(i.name)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${i.qty}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${euro(unit)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${euro(line)}</td>
        </tr>`;
    })
    .join("");

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="background:#f6f7f9;">
          <th style="text-align:left;padding:8px;">Naam</th>
          <th style="text-align:center;padding:8px;">Qty</th>
          <th style="text-align:right;padding:8px;">Unit</th>
          <th style="text-align:right;padding:8px;">Lijn</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function customerConfirmationHtml(args: {
  submissionId: string;
  email: string;
  totalCents: number;
  items: LineItem[];
}) {
  const { submissionId, email, totalCents, items } = args;
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;line-height:1.5;">
      <h2>We hebben je buylist ontvangen</h2>
      <p>Dankjewel! We hebben je buylist ontvangen en gaan ermee aan de slag.</p>
      <p><b>Referentie:</b> ${submissionId}<br/>
         <b>E-mail:</b> ${escapeHtml(email)}<br/>
         <b>Totaal (verwacht):</b> ${euro(totalCents)}</p>

      <h3>Ingezonden items</h3>
      ${renderItemsTable(items)}

      <p style="margin-top:16px;color:#555;">Let op: bedragen zijn indicatief op basis van huidige prijzen.
        Na controle (staat & echtheid) bevestigen we het definitieve bedrag. Je ontvangt dan een update.</p>

      <p>Groet,<br/>Hindrik – Buylist</p>
    </div>
  `;
}

export function internalNewSubmissionHtml(args: {
  submissionId: string;
  email: string;
  totalCents: number;
  items: LineItem[];
}) {
  const { submissionId, email, totalCents, items } = args;
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;line-height:1.5;">
      <h2>Nieuwe buylist ingestuurd</h2>
      <p><b>ID:</b> ${submissionId}<br/>
         <b>Klant:</b> ${escapeHtml(email)}<br/>
         <b>Totaal (calc):</b> ${euro(totalCents)}</p>
      ${renderItemsTable(items)}
      <p style="margin-top:12px;">Admin link: /admin/submissions/${submissionId}</p>
    </div>
  `;
}

function escapeHtml(value: unknown) {
  const s = value == null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


