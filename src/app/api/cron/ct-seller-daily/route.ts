// src/app/api/cron/ct-seller-daily/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function baseUrl() {
  // Production (Vercel)
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // Lokale dev fallback (zet desnoods in .env.local)
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  return "http://localhost:3000";
}

export async function GET() {
  // Bouw absolute URL naar je provider-route
  const url = new URL("/api/providers/ct/orders/sync", baseUrl());
  url.searchParams.set("states", "paid,shipped,hub_pending,hub_shipped,done");
  url.searchParams.set("limit", "100");
  // Laat 'page' weg als je provider zelf pagina's afloopt. Anders:
  // url.searchParams.set("page", "3");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "x-vercel-cron": "1" }, // cron-bypass header
    next: { revalidate: 0 },
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(
    { ok: res.ok, status: res.status, route: "ct-seller-daily", result: data },
    { status: res.ok ? 200 : res.status }
  );
}
