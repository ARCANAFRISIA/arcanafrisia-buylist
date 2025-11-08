function extractSourceFromComment(s?: string | null): { code?: string; date?: Date } {
  if (!s) return {};
  const U = s.toUpperCase();

  // vind eerste token als LLLDDD...
  const m = U.match(/\b([A-Z]{2,4})(\d{4,8})\b/);
  if (!m) return {};

  const [, letters, digits] = m;
  const code = `${letters}${digits}`;

  // datum-afleiding
  let date: Date | undefined;
  if (digits.length === 6) {
    // DDMMYY
    const dd = parseInt(digits.slice(0,2), 10);
    const mm = parseInt(digits.slice(2,4), 10);
    const yy = parseInt(digits.slice(4,6), 10);
    const fullYear = 2000 + yy; // 20xx
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      date = new Date(Date.UTC(fullYear, mm - 1, dd));
    }
  } else if (digits.length === 4) {
    // MMYY (dag = 1)
    const mm = parseInt(digits.slice(0,2), 10);
    const yy = parseInt(digits.slice(2,4), 10);
    const fullYear = 2000 + yy;
    if (mm >= 1 && mm <= 12) {
      date = new Date(Date.UTC(fullYear, mm - 1, 1));
    }
  } else {
    // bv. 7–8 cijfers: kan tracking of iets anders zijn → geen datum
  }

  return { code, date };
}

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const RAW_HOST = process.env.CT_HOST ?? "https://api.cardtrader.com";
const CT_BASE = RAW_HOST.endsWith("/api/v2") ? RAW_HOST : `${RAW_HOST}/api/v2`;
const CT_TOKEN = process.env.CT_TOKEN;

const centsToEur = (c?: number | null) =>
  c == null ? null : Number((c / 100).toFixed(2));

async function ctFetch(path: string) {
  if (!CT_TOKEN) throw new Error("CT_TOKEN missing");
  const res = await fetch(`${CT_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${CT_TOKEN}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CT ${res.status} ${path} :: ${body}`);
  }
  return res.json();
}

export async function GET(req: Request) {
  try {
    const url   = new URL(req.url);

    // ✅ limit/page blijven zoals je had
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? "100"), 200));
    let   page  = Math.max(1, Number(url.searchParams.get("page") ?? "1"));

    // ✅ meerdere states mogelijk, met alias sent→shipped
    const normalize = (s: string) => {
  const x = s.trim().toLowerCase();
  if (x === "sent") return "shipped";       // oude naam
  if (x.startsWith("hub_")) return x;       // alle hub varianten toestaan
  return x;
};

    const states = (url.searchParams.get("states") ?? "paid,shipped,done")
      .split(",").map(normalize).filter(Boolean);

    // ✅ altijd verkoperskant + nieuwste eerst
    const orderAs = "seller";
    const sort    = "date.desc";

    let processedOrders = 0;
    let linesProcessed  = 0;
    let salesUpserts    = 0;

    for (const state of states) {
      // loop pagina’s per state
      let localPage = page;
      while (true) {
        const qs = new URLSearchParams({
          state,
          limit: String(limit),
          page: String(localPage),
          order_as: orderAs,
          sort
        });

        const orders: any[] = await ctFetch(`/orders?${qs.toString()}`);
        if (!Array.isArray(orders) || orders.length === 0) break;

        for (const o of orders) {
          // --- Order upsert (ongewijzigd) ---
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

          // --- Lines + SalesLog (ongewijzigde logica) ---
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

            const allocRatio = linesGross > 0 ? gross / linesGross : 0;
            const feeAlloc = order.sellerFeeEur ? Number((order.sellerFeeEur * allocRatio).toFixed(2)) : null;
            const shipAlloc = order.shippingEur ? Number((order.shippingEur * allocRatio).toFixed(2)) : null;

            const line = await prisma.cTOrderLine.upsert({
              where: { ctLineId },
              update: {
                orderId: order.id,
                blueprintId: li.blueprint_id ?? null,
                cardmarketId: li.mkm_id ?? null,
                scryfallId: li.scryfall_id ?? null,
                isFoil: !!li.properties?.mtg_foil,
                condition: li.properties?.condition ?? null,
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
                quantity: qty,
                unitPriceEur: unit,
                lineGrossEur: gross,
                createdAt: li.created_at ? new Date(li.created_at) : null,
                commentRaw,
              },
              select: { ctLineId: true, blueprintId: true, cardmarketId: true, scryfallId: true, isFoil: true, condition: true, quantity: true },
            });

            const ts = (order.paidAt ?? order.sentAt ?? (li.created_at ? new Date(li.created_at) : new Date()));
            const externalId = `${order.ctOrderId}#${ctLineId}`;

            await prisma.salesLog.upsert({
              where: { source_externalId: { source: "CT", externalId } },
              update: {
                ts,
                ctOrderId: order.ctOrderId,
                blueprintId: line.blueprintId ?? null,
                cardmarketId: line.cardmarketId ?? null,
                scryfallId: line.scryfallId ?? null,
                isFoil: line.isFoil,
                condition: line.condition ?? null,
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
                externalId,
                orderId: order.id,
                ctOrderId: order.ctOrderId,
                ts,
                blueprintId: line.blueprintId ?? null,
                cardmarketId: line.cardmarketId ?? null,
                scryfallId: line.scryfallId ?? null,
                isFoil: line.isFoil,
                condition: line.condition ?? null,
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
          } // items
        } // orders loop

        if (orders.length < limit) break;
        localPage += 1;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    return NextResponse.json({
      ok: true,
      limit,
      page,
      states,
      processedOrders,
      linesProcessed,
      salesUpserts
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
