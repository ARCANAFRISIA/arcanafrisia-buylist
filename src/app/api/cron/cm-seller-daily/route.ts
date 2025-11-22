// src/app/api/cron/cm-seller-daily/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

function baseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL!;
  return "http://localhost:3000";
}

async function hit(base: string, path: string, withBypass = false) {
  const bypass = process.env.VERCEL_PROTECTION_BYPASS || "";
  const url = new URL(path, base);

  const commonHeaders: Record<string, string> = {
    "x-vercel-cron": "1",
    accept: "application/json",
    "user-agent": "vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)",
    ...(ADMIN_TOKEN ? { "x-admin-token": ADMIN_TOKEN } : {}),
    ...(withBypass && bypass ? { "x-vercel-protection-bypass": bypass } : {}),
  };

  let res = await fetch(url.toString(), {
    method: "GET",
    headers: commonHeaders,
    cache: "no-store",
    next: { revalidate: 0 },
  });

  // Fallback: als Protection toch 401 geeft, probeer query-bypass
  if (withBypass && res.status === 401) {
    const u2 = new URL(url.toString());
    u2.searchParams.set("x-vercel-set-bypass-cookie", "true");
    if (bypass) u2.searchParams.set("x-vercel-protection-bypass", bypass);

    const fallbackHeaders: Record<string, string> = {
      "x-vercel-cron": "1",
      accept: "application/json",
      "user-agent": "vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)",
      ...(ADMIN_TOKEN ? { "x-admin-token": ADMIN_TOKEN } : {}),
    };

    res = await fetch(u2.toString(), {
      method: "GET",
      headers: fallbackHeaders,
      cache: "no-store",
      next: { revalidate: 0 },
    });
  }

  let body: any = null;
  try {
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  } catch (e: any) {
    body = { parseError: String(e) };
  }

  return { status: res.status, ok: res.ok, body };
}

export async function GET() {
  const base = baseUrl();

  const paths = [
    `/api/providers/cm/orders/sync?actor=seller&state=bought&start=1&step=100&maxBatches=2`,
    `/api/providers/cm/orders/sync?actor=seller&state=paid&start=1&step=100&maxBatches=2`,
    `/api/providers/cm/orders/sync?actor=seller&state=sent&start=1&step=100&maxBatches=2`,
  ];

  const results: Record<string, any> = {};
  for (const p of paths) {
    // lokaal: withBypass=false; prod: true (maakt niet uit lokaal)
    const r = await hit(base, p, true);
    results[p] = r;
  }

  const allOk = Object.values(results).every((r: any) => r.ok);
  return NextResponse.json(
    { ok: allOk, route: "cm-seller-daily", base, results },
    { status: allOk ? 200 : 207 } // 207 Multi-Status als er mix zit
  );
}
