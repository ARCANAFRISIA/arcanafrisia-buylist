// src/app/api/cron/ct-seller-daily/route.ts
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
  const bypass = process.env.VERCEL_PROTECTION_BYPASS || "";

  // Bouw URL + params
  const u = new URL("/api/providers/ct/orders/sync", base);
  u.searchParams.set("states", "paid,done");
  u.searchParams.set("limit", "50");
  u.searchParams.set("page", "1");
  u.searchParams.set("maxPages", "1");
  u.searchParams.set("timeBudgetMs", "45000");
  u.searchParams.set("from", new Date(Date.now() - 48 * 3600 * 1000).toISOString().slice(0, 10));

  // Eerste poging: met cron-header + UA + (indien aanwezig) protection-bypass header
  let res = await fetch(u.toString(), {
    method: "GET",
    headers: {
      "x-vercel-cron": "1",
      "accept": "application/json",
      "user-agent": "vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)",
      ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
    },
    cache: "no-store",
    next: { revalidate: 0 },
  });

  // Fallback: als Vercel protection tóch 401 geeft, probeer de query-bypass
  if (res.status === 401) {
    const u2 = new URL(u.toString());
    u2.searchParams.set("x-vercel-set-bypass-cookie", "true");
    if (bypass) u2.searchParams.set("x-vercel-protection-bypass", bypass);

    res = await fetch(u2.toString(), {
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

  // Body altijd proberen te lezen (ook bij 4xx), zodat logs nuttig zijn
  let body: any = null;
  try {
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  } catch {
    body = null;
  }

  return NextResponse.json(
    { ok: res.ok, status: res.status, route: "ct-seller-daily", base, result: body },
    { status: res.ok ? 200 : res.status, headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } }
  );
}
