// src/app/api/cron/cm-seller-daily/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function baseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  return "http://localhost:3000";
}

async function hit(path: string) {
  const url = new URL(path, baseUrl());
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "x-vercel-cron": "1" }, // cron-bypass header
    next: { revalidate: 0 },
  });
  try {
    const json = await res.json();
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: res.ok, status: res.status, json: {} };
  }
}

export async function GET() {
  const results: Record<string, any> = {};

  const paths = [
    "/api/providers/cm/orders/sync?actor=seller&state=bought&start=1&step=100&maxBatches=2",
    "/api/providers/cm/orders/sync?actor=seller&state=paid&start=1&step=100&maxBatches=2",
    "/api/providers/cm/orders/sync?actor=seller&state=sent&start=1&step=100&maxBatches=2",
    "/api/providers/cm/orders/sync?actor=seller&state=received&start=1&step=100&maxBatches=2",
  ];

  for (const p of paths) {
    results[p] = await hit(p);
  }

  // Als één van de hits faalt, geef 207 Multi-Status-achtig terug; anders 200
  const anyFail = Object.values(results).some((r: any) => !r?.ok);
  return NextResponse.json(
    { ok: !anyFail, route: "cm-seller-daily", results },
    { status: anyFail ? 207 : 200 }
  );
}
