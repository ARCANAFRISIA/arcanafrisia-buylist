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

  // Kies je eigen parameters hier:
  const u = new URL("/api/ops/apply-sales", base);
  u.searchParams.set("limit", "250");
  // Tip: laat since via SyncCursor lopen; of zet 'm expliciet:
  // u.searchParams.set("since", new Date(Date.now()-24*3600e3).toISOString());
  u.searchParams.set("simulate", "0"); // "1" = droogdraaien

  const res = await fetch(u.toString(), {
    method: "POST",                              // ⬅️ intern POST’en
    headers: {
      "x-vercel-cron": "1",                     // ⬅️ jouw auth-bypass
      "accept": "application/json",
      "user-agent": "vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)",
      ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
    },
    cache: "no-store",
  });

  let body: any = null;
  try {
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  } catch {}

  return NextResponse.json(
    { ok: res.ok, status: res.status, route: "apply-sales", base, result: body },
    { status: res.ok ? 200 : res.status, headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } }
  );
}
