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
