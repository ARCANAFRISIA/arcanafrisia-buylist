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

async function run(req: NextRequest) {
  const base = baseUrl();
  const urlIn = new URL(req.url);

  const u = new URL("/api/ops/apply-sales", base);
  if (urlIn.searchParams.get("limit"))    u.searchParams.set("limit", urlIn.searchParams.get("limit")!);
  if (urlIn.searchParams.get("simulate")) u.searchParams.set("simulate", urlIn.searchParams.get("simulate")!);
  if (urlIn.searchParams.get("since"))    u.searchParams.set("since", urlIn.searchParams.get("since")!);

  const res = await fetch(u.toString(), {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      // server-side admin token
      ...(process.env.ADMIN_TOKEN ? { "x-admin-token": process.env.ADMIN_TOKEN } : {}),
    },
    body: JSON.stringify({}),
    cache: "no-store",
  });

  const text = await res.text();
  let payload: any; try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

  return NextResponse.json(
    { ok: res.ok, status: res.status, proxy: "/api/ops/apply-sales", result: payload },
    { status: res.ok ? 200 : res.status }
  );
}

export async function GET(req: NextRequest)  { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
