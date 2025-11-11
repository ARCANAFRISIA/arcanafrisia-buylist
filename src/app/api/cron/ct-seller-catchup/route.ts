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

  // Catch-up sweep: ruimer venster + extra states + meer pagina's
  const u = new URL("/api/providers/ct/orders/sync", base);
  u.searchParams.set("states", "paid,done,shipped,hub_pending,hub_shipped");
  u.searchParams.set("limit", "100");
  u.searchParams.set("page", "1");
  u.searchParams.set("maxPages", "3");            // ga dieper (1–3)
  u.searchParams.set("timeBudgetMs", "55000");    // iets ruimer
  u.searchParams.set("from", new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString().slice(0, 10)); // 4 dagen

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

  let body: any = null;
  try {
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  } catch { body = null; }

  return NextResponse.json(
    { ok: res.ok, status: res.status, route: "ct-seller-catchup", base, result: body },
    { status: res.ok ? 200 : res.status, headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } }
  );
}
