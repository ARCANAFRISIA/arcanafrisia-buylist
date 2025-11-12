import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

function baseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL!;
  return "http://localhost:3000";
}

export async function GET(_req: NextRequest) {
  const base = baseUrl();

  // build /api/ops/apply-sales URL with your defaults
  const u = new URL("/api/ops/apply-sales", base);
  u.searchParams.set("limit", "250");
  u.searchParams.set("simulate", "0");
  // optionally: u.searchParams.set("since", new Date(Date.now() - 24*3600e3).toISOString());

  const res = await fetch(u.toString(), {
    method: "POST", // ops is POST-only
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)",
      "x-vercel-cron": "1",
      // >>> IMPORTANT: pass the same token ops expects <<<
      ...(process.env.ADMIN_TOKEN ? { "x-admin-token": process.env.ADMIN_TOKEN } : {}),
      ...(process.env.VERCEL_PROTECTION_BYPASS
        ? { "x-vercel-protection-bypass": process.env.VERCEL_PROTECTION_BYPASS }
        : {}),
    },
    body: JSON.stringify({}), // tolerate handlers expecting JSON
    cache: "no-store",
  });

  const text = await res.text();
  let payload: any;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

  // bubble up inner status so logs show 401/400 clearly
  return NextResponse.json(
    { ok: res.ok, status: res.status, proxy: "/api/ops/apply-sales", result: payload },
    { status: res.ok ? 200 : res.status }
  );
}
