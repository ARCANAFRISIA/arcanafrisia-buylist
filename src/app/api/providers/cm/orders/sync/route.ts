export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { buildOAuthHeader } from "@/lib/mkm";

const toBool = (b: any): boolean => {
  if (b === true || b === false) return b;
  if (b === 1 || b === "1" || b === "t" || b === "T" || b === "true" || b === "TRUE") return true;
  if (b === 0 || b === "0" || b === "f" || b === "F" || b === "false" || b === "FALSE") return false;
  return false; // fallback: geen null meer richting Prisma
};


// Zelfde extractor als CT (bron uit comment), lokaal houden om geen imports te breken
function extractSourceFromComment(s?: string | null): { code?: string; date?: Date } {
  if (!s) return {};
  const U = s.toUpperCase();
  const m = U.match(/\b([A-Z]{2,4})(\d{4,8})\b/);
  if (!m) return {};
  const [, letters, digits] = m;
  const code = `${letters}${digits}`;
  let date: Date | undefined;
  if (digits.length === 6) {
    const dd = parseInt(digits.slice(0,2),10);
    const mm = parseInt(digits.slice(2,4),10);
    const yy = parseInt(digits.slice(4,6),10);
    const fullYear = 2000 + yy;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) date = new Date(Date.UTC(fullYear, mm - 1, dd));
  } else if (digits.length === 4) {
    const mm = parseInt(digits.slice(0,2),10);
    const yy = parseInt(digits.slice(2,4),10);
    const fullYear = 2000 + yy;
    if (mm >= 1 && mm <= 12) date = new Date(Date.UTC(fullYear, mm - 1, 1));
  }
  return { code, date };
}

function headersFor(url: string) {
  // Orders is kieskeurig → strict + realm
  return buildOAuthHeader("GET", url, "strict", true);
}

async function mkmFetchJson(url: string) {
  const res = await fetch(url, { headers: headersFor(url), cache: "no-store" });
  const txt = await res.text();
  if (!res.ok) throw new Error(`MKM ${res.status} @ ${url} :: ${txt.slice(0, 240)}`);
  try { return JSON.parse(txt); } catch { throw new Error(`Non-JSON @ ${url} :: ${txt.slice(0,240)}`); }
}

// robuust lezen van verschillende MKM responsevormen
function getOrdersArray(payload: any): any[] {
  if (Array.isArray(payload?.order)) return payload.order;
  if (Array.isArray(payload?.orders?.order)) return payload.orders.order;
  return [];
}
function getArticlesArray(order: any): any[] {
  if (Array.isArray(order?.article)) return order.article;
  if (Array.isArray(order?.articles?.article)) return order.articles.article;
  return [];
}
function toNumber(x: any): number | null {
  if (x == null) return null;
  if (typeof x === "number") return x;
  if (typeof x === "string") return Number(x.replace(",", "."));
  return null;
}
function parseDate(s: any): Date | null {
  if (!s) return null;
  const t = typeof s === "string" ? s : s.toString();
  // CM geeft bv "2025-11-07T12:17:25+0100"
  const iso = t.replace(/(\+\d{2})(\d{2})$/, "$1:$2"); // +0100 -> +01:00
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const actor = (url.searchParams.get("actor") ?? "seller").toLowerCase(); // seller | buyer
    const state = (url.searchParams.get("state") ?? "paid").toLowerCase();   // bought | paid | sent | received | ...
    
    // ✅ START is een offset (1 = eerste 100, 101 = volgende 100, enz.)
    let cursor = Math.max(1, parseInt(url.searchParams.get("start") ?? "1", 10));
    const step  = Math.max(1, parseInt(url.searchParams.get("step") ?? "100", 10)); // default = 100

    let fetchedOrders = 0;
    let upsertOrders = 0;
    let upsertLines  = 0;
    let salesUpserts = 0;

    while (true) {
      // ✅ Cardmarket endpoint werkt offset-based
      const endpoint = `https://api.cardmarket.com/ws/v2.0/output.json/orders/${actor}/${state}/${cursor}`;
      const payload = await mkmFetchJson(endpoint);
      const orders = getOrdersArray(payload);
      const count = orders.length;

      if (count === 0) break; // niets meer → klaar

      for (const o of orders) {
        fetchedOrders++;
        const idOrder = o.idOrder;

        const stObj = typeof o.state === "object" ? o.state : {};
        const stateStr = stObj.state ?? state;
        const dateBought = parseDate(stObj.dateBought ?? o.dateBought);
        const datePaid   = parseDate(stObj.datePaid   ?? o.datePaid);
        const dateSent   = parseDate(stObj.dateSent   ?? o.dateSent);
        const dateRecv   = parseDate(stObj.dateReceived ?? o.dateReceived);

        let totalValueEur: number | null = null;
        let currency = "EUR";
        if (typeof o.totalValue === "object") {
          totalValueEur = toNumber(o.totalValue.value);
          currency = o.totalValue.currency || "EUR";
        } else {
          totalValueEur = toNumber(o.totalValue);
        }

        const order = await prisma.cMOrder.upsert({
          where: { cmOrderId: idOrder },
          update: {
            state: stateStr,
            dateBought: dateBought ?? undefined,
            datePaid:   datePaid   ?? undefined,
            dateSent:   dateSent   ?? undefined,
            dateReceived: dateRecv ?? undefined,
            currency,
            totalValueEur: totalValueEur ?? undefined,
            articleCount:  o.articleCount ?? undefined,
            buyerUsername:  o.buyer?.username  ?? undefined,
            sellerUsername: o.seller?.username ?? undefined,
          },
          create: {
            cmOrderId: idOrder,
            state: stateStr,
            dateBought: dateBought ?? undefined,
            datePaid:   datePaid   ?? undefined,
            dateSent:   dateSent   ?? undefined,
            dateReceived: dateRecv ?? undefined,
            currency,
            totalValueEur: totalValueEur ?? undefined,
            articleCount:  o.articleCount ?? undefined,
            buyerUsername:  o.buyer?.username  ?? undefined,
            sellerUsername: o.seller?.username ?? undefined,
          },
          select: { id: true, cmOrderId: true, datePaid: true }
        });
        upsertOrders++;

        const articles = getArticlesArray(o);
        for (const li of articles) {
          const qty = li.count ?? li.quantity ?? 1;
          const unit = toNumber(li.price) ?? 0;
          const gross = Number((unit * qty).toFixed(2));

          const cmLineId = li.idArticle;
          const commentRaw = li.comments ?? li.comment ?? null;
          const { code: sourceCode, date: sourceDate } = extractSourceFromComment(commentRaw);

          const line = await prisma.cMOrderLine.upsert({
            where: { cmLineId },
            update: {
              orderId: order.id,
              cardmarketId: li.idProduct ?? undefined,
              isFoil: !!li.isFoil,
              condition: li.condition ?? undefined,
              language: li.language?.languageName ?? li.language ?? undefined,
              expansion: li.expansion ?? undefined,
              quantity: qty,
              unitPriceEur: unit,
              lineGrossEur: gross,
              createdAt: parseDate(li.lastEdited) ?? undefined,
              commentRaw,
            },
            create: {
              cmLineId,
              orderId: order.id,
              cardmarketId: li.idProduct ?? undefined,
              isFoil: !!li.isFoil,
              condition: li.condition ?? undefined,
              language: li.language?.languageName ?? li.language ?? undefined,
              expansion: li.expansion ?? undefined,
              quantity: qty,
              unitPriceEur: unit,
              lineGrossEur: gross,
              createdAt: parseDate(li.lastEdited) ?? undefined,
              commentRaw,
            },
            select: { cmLineId: true, cardmarketId: true, isFoil: true, condition: true, quantity: true }
          });
          upsertLines++;

          // ✅ Alleen sales loggen als "seller"
          if (actor === "seller") {
            const ts = (order.datePaid ?? dateBought ?? new Date());
            const externalId = `${order.cmOrderId}#${line.cmLineId}`;
            await prisma.salesLog.upsert({
              where: { source_externalId: { source: "CM", externalId } },
              update: {
                ts,
                cmOrderId: order.cmOrderId,
                cardmarketId: line.cardmarketId ?? null,
                blueprintId: null,
                scryfallId: null,
                isFoil: toBool(line.isFoil),
                condition: line.condition ?? null,
                qty,
                unitPriceEur: unit,
                lineTotalEur: gross,
                feeEur: null,
                shippingEur: null,
                comment: commentRaw ?? undefined,
                sourceCode: sourceCode ?? undefined,
                sourceDate: sourceDate ?? undefined,
              },
              create: {
                source: "CM",
                externalId,
                orderId: order.id,
                cmOrderId: order.cmOrderId,
                ts,
                cardmarketId: line.cardmarketId ?? null,
                blueprintId: null,
                scryfallId: null,
                isFoil: toBool(line.isFoil),
                condition: line.condition ?? null,
                qty,
                unitPriceEur: unit,
                lineTotalEur: gross,
                feeEur: null,
                shippingEur: null,
                comment: commentRaw ?? undefined,
                sourceCode: sourceCode ?? undefined,
                sourceDate: sourceDate ?? undefined,
              }
            });
            salesUpserts++;
          }
        }
      }

      // ✅ Belangrijk: MKM gebruikt offset, geen pagina-index
      cursor += step;
      if (count < 100) break; // laatste pagina
      await new Promise(r => setTimeout(r, 250));
    }

    return NextResponse.json({
  ok: true,
  actor,
  state,
  start: cursor,
  step,
  fetchedOrders,
  upsertOrders,
  upsertLines,
  salesUpserts,
  nextStart: cursor + step
});

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? String(e) }, { status: 500 });
  }
}
