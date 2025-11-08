// src/app/api/providers/cm/orders/probe/route.ts
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { buildOAuthHeader } from "@/lib/mkm";

async function mkmFetchJson(url: string) {
  // ⇩ strict + realm=true (orders is kieskeurig)
  const headers = buildOAuthHeader("GET", url, "strict", true);
  const res = await fetch(url, { headers, cache: "no-store" });
  const txt = await res.text();
  if (!res.ok) throw new Error(`MKM ${res.status} @ ${url} :: ${txt.slice(0, 240)}`);
  try { return JSON.parse(txt); } catch { throw new Error(`Non-JSON @ ${url} :: ${txt.slice(0,240)}`); }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const actor = (url.searchParams.get("actor") ?? "seller").toLowerCase();
    const state = (url.searchParams.get("state") ?? "paid").toLowerCase();
    const start = Math.max(1, parseInt(url.searchParams.get("start") ?? "1", 10));

    const endpoint = `https://api.cardmarket.com/ws/v2.0/output.json/orders/${actor}/${state}/${start}`;
    const data = await mkmFetchJson(endpoint);

    const arr: any[] =
      Array.isArray(data?.order) ? data.order :
      Array.isArray(data?.orders?.order) ? data.orders.order : [];

    const sample = arr.slice(0, 5).map((o: any) => ({
      idOrder: o.idOrder,
      state: o.state,
      datePaid: o.datePaid ?? null,
      articleCount: o.articleCount ?? null,
      totalValue: o.totalValue ?? null,
      buyer: o.buyer?.username ?? null,
      seller: o.seller?.username ?? null,
    }));

    return NextResponse.json({ ok: true, actor, state, start, count: arr.length, sample });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e.message }, { status: 500 });
  }
}
