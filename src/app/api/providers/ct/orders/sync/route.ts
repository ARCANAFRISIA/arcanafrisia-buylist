// --- JOUW helpers blijven ---
function extractSourceFromComment(s?: string | null): { code?: string; date?: Date } {
  if (!s) return {};
  const U = s.toUpperCase();
  const m = U.match(/\b([A-Z]{2,4})(\d{4,8})\b/);
  if (!m) return {};
  const [, letters, digits] = m;
  const code = `${letters}${digits}`;
  let date: Date | undefined;
  if (digits.length === 6) {
    const dd = parseInt(digits.slice(0,2), 10);
    const mm = parseInt(digits.slice(2,4), 10);
    const yy = parseInt(digits.slice(4,6), 10);
    const fullYear = 2000 + yy;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) date = new Date(Date.UTC(fullYear, mm - 1, dd));
  } else if (digits.length === 4) {
    const mm = parseInt(digits.slice(0,2), 10);
    const yy = parseInt(digits.slice(2,4), 10);
    const fullYear = 2000 + yy;
    if (mm >= 1 && mm <= 12) date = new Date(Date.UTC(fullYear, mm - 1, 1));
  }
  return { code, date };
}

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isVercelCron } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RAW_HOST = process.env.CT_HOST ?? "https://api.cardtrader.com";
const CT_BASE = RAW_HOST.endsWith("/api/v2") ? RAW_HOST : `${RAW_HOST}/api/v2`;
const CT_TOKEN = process.env.CT_TOKEN;

const centsToEur = (c?: number | null) => c == null ? null : Number((c / 100).toFixed(2));

function normalizeCTLanguage(raw?: string | null): string {
  if (!raw) return "EN"; // default

  const s = raw.trim().toUpperCase();

  const map: Record<string, string> = {
    "EN": "EN",
    "ENGLISH": "EN",
    "DE": "DE",
    "GERMAN": "DE",
    "FR": "FR",
    "FRENCH": "FR",
    "ES": "ES",
    "SPANISH": "ES",
    "IT": "IT",
    "ITALIAN": "IT",
    "PT": "PT",
    "PORTUGUESE": "PT",
    "JA": "JA",
    "JP": "JA",
    "JAPANESE": "JA",
    "ZH": "ZHS",            // evt. splitten als CT dat doet
    "CHINESE": "ZHS",
  };

  if (map[s]) return map[s];

  // fallback: eerste 2 letters, bv "ENGLISH (EU)" → "EN"
  return s.slice(0, 2);
}

// --- TERUG naar jouw simpele fetch; geen extra headers, geen andere params ---
async function ctFetch(path: string) {
  if (!CT_TOKEN) throw new Error("CT_TOKEN missing");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000); // 20s hard timeout

  try {
    const res = await fetch(`${CT_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${CT_TOKEN}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`CT ${res.status} ${path} :: ${bodyText}`);
    }
    try { return JSON.parse(bodyText); } catch { return bodyText; }
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const cron = isVercelCron(req);

  if (process.env.NODE_ENV === "production" && !cron) {
    const token = req.headers.get("x-admin-token");
    if (!token || token !== process.env.ADMIN_TOKEN) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } }
      );
    }
  }

  try {
    const url   = req.nextUrl;

    // ✅ laat jouw parameters & defaults intact
    const t0 = Date.now();
    const DEFAULT_BUDGET = Math.max(10_000, Math.min(Number(url.searchParams.get("timeBudgetMs") ?? "45000"), 55_000));
    const timeLeft = () => Math.max(0, DEFAULT_BUDGET - (Date.now() - t0));

    const maxPages = Math.max(1, Math.min(Number(url.searchParams.get("maxPages") ?? "1"), 10)); // hard cap
    const limit    = Math.max(1, Math.min(Number(url.searchParams.get("limit")    ?? "100"), 200));
    let   page     = Math.max(1, Number(url.searchParams.get("page") ?? "1"));

    const normalize = (s: string) => {
      const x = s.trim().toLowerCase();
      if (x === "sent") return "shipped";
      if (x.startsWith("hub_")) return x;
      return x;
    };
    const states = (url.searchParams.get("states") ?? "paid,done")
      .split(",").map(normalize).filter(Boolean);

    const orderAs = "seller";
    const sort    = "date.desc";

    let processedOrders = 0;
    let linesProcessed  = 0;
    let salesUpserts    = 0;

    for (const state of states) {
      let localPage = page;
      let pagesDoneForThisState = 0;

      
      while (true) {
         // === Nieuw: strikte guards ===
        if (timeLeft() < 1500) break;
        if (pagesDoneForThisState >= maxPages) break;

      const qs = new URLSearchParams({
  state,
  limit: String(limit),
  page:  String(localPage),
  order_as: orderAs,
  sort
});

// <-- NIEUW: from/to doorzetten als ze in de URL staan
const from = url.searchParams.get("from");
const to   = url.searchParams.get("to");
if (from) qs.set("from", from);
if (to)   qs.set("to", to);

        const orders: any[] = await ctFetch(`/orders?${qs.toString()}`);
        if (!Array.isArray(orders) || orders.length === 0) break;

        for (const o of orders) {
          // --- jouw bestaande upserts onveranderd ---
          const order = await prisma.cTOrder.upsert({
            where: { ctOrderId: o.id },
            update: {
              state: o.state,
              paidAt: o.paid_at ? new Date(o.paid_at) : null,
              sentAt: o.sent_at ? new Date(o.sent_at) : null,
              creditAddedAt: o.credit_added_to_seller_at ? new Date(o.credit_added_to_seller_at) : null,
              currency: (o.seller_total?.currency ?? "EUR"),
              sellerTotalEur: centsToEur(o.seller_total?.cents),
              sellerSubtotalEur: centsToEur(o.seller_subtotal?.cents),
              sellerFeeEur: centsToEur(o.seller_fee_amount?.cents),
              shippingEur: centsToEur(o.order_shipping_method?.seller_price?.cents),
            },
            create: {
              ctOrderId: o.id,
              state: o.state,
              paidAt: o.paid_at ? new Date(o.paid_at) : null,
              sentAt: o.sent_at ? new Date(o.sent_at) : null,
              creditAddedAt: o.credit_added_to_seller_at ? new Date(o.credit_added_to_seller_at) : null,
              currency: (o.seller_total?.currency ?? "EUR"),
              sellerTotalEur: centsToEur(o.seller_total?.cents),
              sellerSubtotalEur: centsToEur(o.seller_subtotal?.cents),
              sellerFeeEur: centsToEur(o.seller_fee_amount?.cents),
              shippingEur: centsToEur(o.order_shipping_method?.seller_price?.cents),
            },
            select: { id: true, ctOrderId: true, sellerSubtotalEur: true, shippingEur: true, sellerFeeEur: true, paidAt: true, sentAt: true }
          });
          processedOrders++;

          const items: any[] = o.order_items ?? [];
          const linesGross = items.reduce((acc, li) => {
            const unit = centsToEur(li.seller_price?.cents) ?? 0;
            return acc + unit * (li.quantity ?? 1);
          }, 0);

          linesProcessed += items.length;

          for (const li of items) {
            const ctLineId = li.id;
            const unit = centsToEur(li.seller_price?.cents) ?? 0;
            const qty = li.quantity ?? 1;
            const gross = Number((unit * qty).toFixed(2));

            const commentRaw: string | null = li.description ?? null;
            const { code: sourceCode, date: sourceDate } = extractSourceFromComment(commentRaw);

            const languageRaw: string | null =
  (li.properties?.language as string | null) ??
  (li.properties?.lang as string | null) ??
  null;

const language = normalizeCTLanguage(languageRaw);

            const allocRatio = linesGross > 0 ? gross / linesGross : 0;
            const sellerFeeNum = order.sellerFeeEur == null ? null : Number(order.sellerFeeEur);
            const shippingNum  = order.shippingEur == null ? null : Number(order.shippingEur);
            const feeAlloc  = sellerFeeNum === null ? null : Math.round(sellerFeeNum * allocRatio * 100) / 100;
            const shipAlloc = shippingNum  === null ? null : Math.round(shippingNum  * allocRatio * 100) / 100;

            const line = await prisma.cTOrderLine.upsert({
              where: { ctLineId },
              update: {
                orderId: order.id,
                blueprintId: li.blueprint_id ?? null,
                cardmarketId: li.mkm_id ?? null,
                scryfallId: li.scryfall_id ?? null,
                isFoil: !!li.properties?.mtg_foil,
                condition: li.properties?.condition ?? null,
                language,
                quantity: qty,
                unitPriceEur: unit,
                lineGrossEur: gross,
                createdAt: li.created_at ? new Date(li.created_at) : null,
                commentRaw,
              },
              create: {
                ctLineId,
                orderId: order.id,
                blueprintId: li.blueprint_id ?? null,
                cardmarketId: li.mkm_id ?? null,
                scryfallId: li.scryfall_id ?? null,
                isFoil: !!li.properties?.mtg_foil,
                condition: li.properties?.condition ?? null,
                language,
                quantity: qty,
                unitPriceEur: unit,
                lineGrossEur: gross,
                createdAt: li.created_at ? new Date(li.created_at) : null,
                commentRaw,
              },
              select: { ctLineId: true, blueprintId: true, cardmarketId: true, scryfallId: true, isFoil: true, condition: true, language: true, quantity: true },
            });

            const ts = (order.paidAt ?? order.sentAt ?? (li.created_at ? new Date(li.created_at) : new Date()));
            const externalId = `${order.ctOrderId}#${ctLineId}`;

            // ✅ DEDUPE PRIMAIR OP (source, ctLineId), FALLBACK (source, externalId)
await prisma.salesLog.upsert({
  where: (ctLineId != null && Number.isFinite(Number(ctLineId)))
    ? { source_ctLineId: { source: "CT", ctLineId: Number(ctLineId) } }
    : { source_externalId: { source: "CT", externalId } },

  // ⚠️ identifiers en historie niet overschrijven; alleen velden die legitiem kunnen wijzigen
  update: {
    ts,
    // ctOrderId, externalId en ctLineId blijven zoals bij create (niet muteren)
    blueprintId: line.blueprintId ?? null,
    cardmarketId: line.cardmarketId ?? null,
    scryfallId: line.scryfallId ?? null,
    isFoil: line.isFoil,
    condition: line.condition ?? null,
    language: line.language ?? language ?? "EN",
    qty,
    unitPriceEur: unit,
    lineTotalEur: gross,
    feeEur: feeAlloc,
    shippingEur: shipAlloc,
    comment: commentRaw ?? undefined,
    sourceCode: sourceCode ?? undefined,
    sourceDate: sourceDate ?? undefined,
  },

  create: {
    source: "CT",
    externalId,                     // bv. "25517787#74676791"
    ctOrderId: order.ctOrderId,     // is al BigInt via select
    ctLineId: Number(ctLineId),     // 🔑 nieuw veld voor dedupe
    orderId: order.id,

    ts,
    blueprintId: line.blueprintId ?? null,
    cardmarketId: line.cardmarketId ?? null,
    scryfallId: line.scryfallId ?? null,
    isFoil: line.isFoil,
    condition: line.condition ?? null,
    language: line.language ?? language ?? "EN",
    qty,
    unitPriceEur: unit,
    lineTotalEur: gross,
    feeEur: feeAlloc,
    shippingEur: shipAlloc,
    comment: commentRaw ?? undefined,
    sourceCode: sourceCode ?? undefined,
    sourceDate: sourceDate ?? undefined,
  }
});


            salesUpserts++;
          }
        }

        pagesDoneForThisState += 1; // <-- typo-fix
        if (orders.length < limit) break;
        localPage += 1;

        if (timeLeft() < 1500) break;
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return NextResponse.json(
      { ok: true, limit, page, states, processedOrders, linesProcessed, salesUpserts },
      { headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } }
    );
  }
}
