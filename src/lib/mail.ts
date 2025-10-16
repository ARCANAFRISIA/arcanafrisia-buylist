// src/lib/mail.ts
export const runtime = "nodejs";
import { Resend } from "resend";

if (!process.env.RESEND_API_KEY) {
  console.warn("[mail] RESEND_API_KEY is missing");
}
const resend = new Resend(process.env.RESEND_API_KEY);

type SendMailArgs = {
  to?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
};

export async function sendMail(args: SendMailArgs) {
  const from = process.env.MAIL_FROM;
  const fallbackTo = process.env.MAIL_ADMIN ?? process.env.MAIL_FROM;

  if (!from) {
    console.error("[mail] MAIL_FROM missing");
    throw new Error("MAIL_FROM missing");
  }
  const to = args.to ?? fallbackTo;
  if (!to) {
    console.warn("[mail] skipped: no recipient");
    return { skipped: true };
  }

  const res = await resend.emails.send({
    from,
    to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    reply_to: args.replyTo,
  });
  console.log("[mail] sent:", { to, subject: args.subject, id: (res as any)?.id ?? null });
  return res;
}

export function euro(cents: number | null | undefined): string {
  const n = typeof cents === "number" ? cents : 0;
  return `€ ${(n / 100).toFixed(2)}`;
}
// --- helpers & templates (exports die je route verwacht) ---

export function euro(cents: number | null | undefined): string {
  const n = typeof cents === "number" ? cents : 0;
  return `€ ${(n / 100).toFixed(2)}`;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Client confirmation email
export function customerConfirmationHtml(args: {
  submissionId: string | number;
  email: string;
  totalCents: number;
  items: Array<{ name: string; qty: number; unitCents: number; lineCents: number }>;
}) {
  const { submissionId, email, totalCents, items } = args;

  const rows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(i.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${i.qty}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${euro(i.unitCents)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${euro(i.lineCents)}</td>
      </tr>`
    )
    .join("");

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
    <h2 style="margin:0 0 8px">Bedankt voor je buylist!</h2>
    <p style="margin:0 0 12px">Referentie: <strong>${esc(String(submissionId))}</strong></p>
    <p style="margin:0 0 12px">We hebben je inzending ontvangen op <strong>${esc(email)}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ccc">Item</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ccc">Qty</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ccc">Unit</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ccc">Totaal</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:8px;color:#666">Geen regels</td></tr>`}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="text-align:right;padding:8px 8px 0 8px;font-weight:600">Totaal</td>
          <td style="text-align:right;padding:8px 8px 0 8px;font-weight:600">${euro(totalCents)}</td>
        </tr>
      </tfoot>
    </table>
    <p style="font-size:12px;color:#666;margin-top:16px">
      Let op: voorlopig bedrag op basis van opgegeven conditie. Definitief na ontvangst & controle.
    </p>
  </div>`;
}

// Internal notification email
export function internalNewSubmissionHtml(args: {
  submissionId: string | number;
  email: string;
  totalCents: number;
  items: Array<{ name: string; qty: number; unitCents: number; lineCents: number }>;
}) {
  const { submissionId, email, totalCents, items } = args;

  const rows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:4px 6px;border-bottom:1px solid #eee">${esc(i.name)}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${i.qty}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${euro(i.unitCents)}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${euro(i.lineCents)}</td>
      </tr>`
    )
    .join("");

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
    <h3 style="margin:0 0 8px">Nieuwe buylist – ${esc(String(submissionId))}</h3>
    <p style="margin:0 0 8px"><strong>Klant:</strong> ${esc(email)}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <thead>
        <tr>
          <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #ccc">Item</th>
          <th style="text-align:right;padding:4px 6px;border-bottom:1px solid #ccc">Qty</th>
          <th style="text-align:right;padding:4px 6px;border-bottom:1px solid #ccc">Unit</th>
          <th style="text-align:right;padding:4px 6px;border-bottom:1px solid #ccc">Totaal</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:8px;color:#666">Geen regels</td></tr>`}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="text-align:right;padding:8px 6px 0 6px;font-weight:600">Totaal</td>
          <td style="text-align:right;padding:8px 6px 0 6px;font-weight:600">${euro(totalCents)}</td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}
