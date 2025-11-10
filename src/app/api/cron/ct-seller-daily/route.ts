import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function baseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  return "http://localhost:3000";
}

export async function GET() {
  const base = baseUrl();

  const url = new URL("/api/providers/ct/orders/sync", base);
  url.searchParams.set("states", "paid,done");
  url.searchParams.set("limit", "50");      // kleine hap
  url.searchParams.set("page", "1");        // alleen eerste pagina
  url.searchParams.set("maxPages", "1");    // provider loopt niet door
  url.searchParams.set("timeBudgetMs", "45000");
  url.searchParams.set("from", new Date(Date.now() - 48*3600*1000).toISOString().slice(0,10)); // 48u window

const res = await fetch(url.toString(), {
  method: "GET",
  headers: {
    // ✅ Zorg dat de provider altijd cron herkent
    "x-vercel-cron": "1",
    "accept": "application/json",
    // ✅ Extra zekerheid: sommige paden vertrouwen op UA
    "user-agent": "vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)",
  },
  cache: "no-store",
  next: { revalidate: 0 },
});

// Probeer body te lezen, ook bij 4xx:
let body: any = null;
try {
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
} catch { body = null; }

return NextResponse.json(
  {
    ok: res.ok,
    status: res.status,
    route: "ct-seller-daily",
    base,
    result: body,
  },
  { status: res.ok ? 200 : res.status }
);

}
