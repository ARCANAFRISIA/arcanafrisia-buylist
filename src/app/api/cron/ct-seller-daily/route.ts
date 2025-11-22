// src/app/api/cron/ct-seller-daily/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

function baseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL!;
  return "http://localhost:3000";
}

export async function GET() {
  const base = baseUrl();
  const bypass = process.env.VERCEL_PROTECTION_BYPASS || "";

  // Bouw URL + params (dagelijks: paid/done, iets breder venster)
  const u = new URL("/api/providers/ct/orders/sync", base);
  u.searchParams.set("states", "paid,done");
  u.searchParams.set("limit", "100"); // grotere hap
  u.searchParams.set("page", "1");
  u.searchParams.set("maxPages", "2"); // pagina 1–2
  u.searchParams.set("timeBudgetMs", "45000");
  u.searchParams.set(
    "from",
    new Date(Date.now() - 72 * 3600 * 1000).toISOString().slice(0, 10)
  ); // 72h window

  const commonHeaders: Record<string, string> = {
    "x-vercel-cron": "1",
    accept: "application/json",
    "user-agent":
      "vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)",
    ...(ADMIN_TOKEN ? { "x-admin-token": ADMIN_TOKEN } : {}),
    ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
  };

  // Eerste poging: cron-header + UA + (optioneel) protection-bypass + admin-token
  let res = await fetch(u.toString(), {
    method: "GET",
    headers: commonHeaders,
    cache: "no-store",
    next: { revalidate: 0 },
  });

  // Fallback bij 401: query-bypass
  if (res.status === 401) {
    const u2 = new URL(u.toString());
    u2.searchParams.set("x-vercel-set-bypass-cookie", "true");
    if (bypass) u2.searchParams.set("x-vercel-protection-bypass", bypass);

    const fallbackHeaders: Record<string, string> = {
      "x-vercel-cron": "1",
      accept: "application/json",
      "user-agent":
        "vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)",
      ...(ADMIN_TOKEN ? { "x-admin-token": ADMIN_TOKEN } : {}),
    };

    res = await fetch(u2.toString(), {
      method: "GET",
      headers: fallbackHeaders,
      cache: "no-store",
      next: { revalidate: 0 },
    });
  }

  // Body altijd proberen te lezen (handig voor logs)
  let body: any = null;
  try {
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  } catch {
    body = null;
  }

  return NextResponse.json(
    {
      ok: res.ok,
      status: res.status,
      route: "ct-seller-daily",
      base,
      result: body,
    },
    {
      status: res.ok ? 200 : res.status,
      headers: {
        "Cache-Control":
          "no-store, no-cache, max-age=0, must-revalidate",
      },
    }
  );
}
