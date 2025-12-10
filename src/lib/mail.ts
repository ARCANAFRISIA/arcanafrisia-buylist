// src/lib/mail.ts
export const runtime = "nodejs";

import { Resend } from "resend";

if (!process.env.RESEND_API_KEY) {
  console.warn("[mail] RESEND_API_KEY is missing");
}

const resend = new Resend(process.env.RESEND_API_KEY);

// ---------- core sender ----------
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
    console.warn("[mail] skipped: no recipient (no to / MAIL_ADMIN / MAIL_FROM)");
    return { skipped: true as const };
  }

  // simpele html→text fallback (houdt het type van Resend tevreden)
function htmlToText(html?: string) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const res = await resend.emails.send({
  from,
  to,
  subject: args.subject,
  html: args.html,
  // Resend types verlangen text: string — nooit undefined meegeven
  text: args.text ?? htmlToText(args.html),
  replyTo: args.replyTo,
});


  console.log("[mail] sent:", { to, subject: args.subject, id: (res as any)?.id ?? null });
  return res;
}

// ---------- helpers (single definitions!) ----------
export function euro(cents: number | null | undefined): string {
  const n = typeof cents === "number" ? cents : 0;
  return `€ ${(n / 100).toFixed(2)}`;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- HTML templates ----------
export function customerConfirmationHtml(args: {
  submissionId: string | number;
  email: string;
  totalCents: number;
  items: Array<{ name: string; qty: number; unitCents: number; lineCents: number }>;
  shippingMethod?: "SELF" | "LABEL";
  labelFree?: boolean;
}) {
  const {
    submissionId,
    email,
    totalCents,
    items,
    shippingMethod,
    labelFree,
  } = args;


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

  const euroTotal = euro(totalCents);

  // ✉️ verzend-instructies
  let shippingIntro = "";
  let shippingDetails = "";

  // Vul hier je daadwerkelijke ontvangstadres in:
  const arcanaAddressLines = [
    "ArcanaFrisia",
    "Hindrik Arendz",
    "Ulelflecht 18",
    "9244 ET Beetsterzwaag",
    "Nederland",
  ];

  const arcanaAddressHtml = arcanaAddressLines.map(esc).join("<br/>");

  if (shippingMethod === "LABEL") {
    shippingIntro =
      labelFree
        ? "Je hebt gekozen voor een verzendlabel via ArcanaFrisia. Omdat je buylist boven de €150 uitkomt, is dit label gratis."
        : "Je hebt gekozen voor een verzendlabel via ArcanaFrisia. De kosten hiervoor zijn €5,-.";

    shippingDetails = `
      <p style="margin:8px 0 8px">
        Binnen 1 werkdag ontvang je van ons een aparte e-mail met een verzendlabel
        (of barcode) dat je bij het postpunt kunt laten scannen.
      </p>
      <p style="margin:0 0 8px">
        Verpak je kaarten goed, sorteer ze in dezelfde volgorde als in de tabel hierboven,
        verwijder sleeves/toploaders, stop de kaarten in een zakje en vervolgens in een stevige verpakking of bubbel envelop.
      </p>
    `;
  } else {
    shippingIntro =
      "Je hebt aangegeven de zending zelf te versturen (eigen risico). Gebruik bij voorkeur een verzendmethode met tracking.";

    shippingDetails = `
      <p style="margin:8px 0 4px">
        Verstuur je kaarten naar het volgende adres:
      </p>
      <p style="margin:0 0 8px">
        ${arcanaAddressHtml}
      </p>
      <p style="margin:0 0 8px">
        Sorteer de kaarten in dezelfde volgorde als in de tabel hierboven,
        verwijder sleeves/toploaders, stop de kaarten in een zakje en vervolgens in een stevige verpakking of bubbel envelop.
      </p>
    `;
  }


  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
    <h2 style="margin:0 0 8px">Bedankt voor je buylist!</h2>
    <p style="margin:0 0 12px">
      Referentie: <strong>${esc(String(submissionId))}</strong>
    </p>
    <p style="margin:0 0 12px">
      We hebben je inzending ontvangen op <strong>${esc(email)}</strong>.
      Het voorlopig totaalbedrag is <strong>${euroTotal}</strong>.
    </p>

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
          <td style="text-align:right;padding:8px 8px 0 8px;font-weight:600">${euroTotal}</td>
        </tr>
      </tfoot>
    </table>

    <p style="margin:16px 0 4px;font-weight:600">Verzending & verpakking</p>
    <p style="margin:0 0 4px;">${esc(shippingIntro)}</p>
    ${shippingDetails}

    <p style="margin:12px 0 4px;font-weight:600">Controle & uitbetaling</p>
    <p style="margin:0 0 4px;">
      Zodra we je zending hebben ontvangen, controleren we de kaarten op aantal, versie en conditie.
    </p>
    <p style="margin:0 0 4px;">
      Als alles klopt, bevestigen we het definitieve bedrag en betalen we meestal binnen
      <strong>2 werkdagen</strong> uit.
    </p>
    <p style="margin:0 0 8px;font-size:12px;color:#666">
      Afwijkingen in conditie of kaartversie kunnen kleine aanpassingen in het totaalbedrag geven.
    </p>

    <p style="margin:8px 0 0;font-size:12px;color:#666">
      Tip: check eventueel ook je spamfolder als je geen e-mails van ons ziet.
    </p>
  </div>`;
}



export function internalNewSubmissionHtml(args: {
  submissionId: string | number;
  email: string;
  totalCents: number;
  items: Array<{ name: string; qty: number; unitCents: number; lineCents: number }>;
  shippingMethod?: "SELF" | "LABEL";
  labelFree?: boolean;

  fullName?: string;
  addressLine1?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  payoutMethod?: string;   // "BANK" | "PAYPAL"
  iban?: string;
  paypalEmail?: string;
}) {
  const {
    submissionId,
    email,
    totalCents,
    items,
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
  } = args;



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

  // shipping
  let shippingText = "Onbekend (geen keuze meegestuurd)";
  if (shippingMethod === "SELF") {
    shippingText = "Klant verstuurt zelf (eigen risico)";
  } else if (shippingMethod === "LABEL") {
    shippingText = labelFree
      ? "Label gevraagd via ArcanaFrisia – GRATIS (≥ €150)"
      : "Label gevraagd via ArcanaFrisia – €5,-";
  }

  // adres
  const addressLines: string[] = [];
  if (fullName) addressLines.push(fullName);
  if (addressLine1) addressLines.push(addressLine1);
  const cityLineParts = [];
  if (postalCode) cityLineParts.push(postalCode);
  if (city) cityLineParts.push(city);
  if (cityLineParts.length) addressLines.push(cityLineParts.join(" "));
  if (country) addressLines.push(country);
  const addressHtml = addressLines.length
    ? addressLines.map((l) => esc(l)).join("<br/>")
    : "Onbekend";

  // payout
  let payoutText = "Onbekend";
  if (payoutMethod === "BANK") {
    payoutText = `Bankoverschrijving (IBAN: ${esc(iban || "onbekend")})`;
  } else if (payoutMethod === "PAYPAL") {
    payoutText = `PayPal (${esc(paypalEmail || "onbekend")})`;
  }



  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
    <h3 style="margin:0 0 8px">Nieuwe buylist – ${esc(String(submissionId))}</h3>
    <p style="margin:0 0 8px"><strong>Klant:</strong> ${esc(email)}</p>

    <p style="margin:0 0 4px"><strong>Adres:</strong></p>
    <p style="margin:0 0 8px">${addressHtml}</p>

    <p style="margin:0 0 4px"><strong>Betaalmethode:</strong> ${esc(payoutText)}</p>
    <p style="margin:0 0 8px"><strong>Shipping:</strong> ${esc(shippingText)}</p>

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
