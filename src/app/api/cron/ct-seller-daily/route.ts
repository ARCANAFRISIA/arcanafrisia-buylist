import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function baseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  return "http://localhost:3000";
}

const bypass = process.env.VERCEL_PROTECTION_BYPASS || "";

const u = new URL("/api/providers/ct/orders/sync", base);
u.searchParams.set("states", "paid,done");
u.searchParams.set("limit", "50");
u.searchParams.set("page", "1");
u.searchParams.set("maxPages", "1");
u.searchParams.set("timeBudgetMs", "45000");
u.searchParams.set("from", new Date(Date.now() - 48 * 3600 * 1000).toISOString().slice(0, 10));

let res = await fetch(u.toString(), {
  method: "GET",
  headers: {
    "x-vercel-cron": "1",
    "accept": "application/json",
    "user-agent": "vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)",
    // ⬇️ belangrijkste header voor Vercel Protection:
    ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
  },
  cache: "no-store",
  next: { revalidate: 0 },
});

// fallback: als het tóch een 401 protection page is, probeer query-bypass
if (res.status === 401) {
  u.searchParams.set("x-vercel-set-bypass-cookie", "true");
  if (bypass) u.searchParams.set("x-vercel-protection-bypass", bypass);
  res = await fetch(u.toString(), {
    method: "GET",
    headers: {
      "x-vercel-cron": "1",
      "accept": "application/json",
      "user-agent": "vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)",
    },
    cache: "no-store",
    next: { revalidate: 0 },
  });
}

let body: any = null;
try {
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = { raw: text } }
} catch {}

return NextResponse.json(
  { ok: res.ok, status: res.status, route: "ct-seller-daily", base, result: body },
  { status: res.ok ? 200 : res.status, headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } }
);




