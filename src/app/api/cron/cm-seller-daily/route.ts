// src/app/api/cron/cm-seller-daily/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function hit(path: string) {
  const res = await fetch(path, { method: "GET" });
  try { return await res.json(); } catch { return {}; }
}

export async function GET() {
  const results: any = {};
  
  const paths = [
    `/api/providers/cm/orders/sync?actor=seller&state=bought&start=1&step=100&maxBatches=2`,
    `/api/providers/cm/orders/sync?actor=seller&state=paid&start=1&step=100&maxBatches=2`,
    `/api/providers/cm/orders/sync?actor=seller&state=sent&start=1&step=100&maxBatches=2`,
    `/api/providers/cm/orders/sync?actor=seller&state=received&start=1&step=100&maxBatches=2`,
    
  ];
  for (const p of paths) {
    results[p] = await hit(p);
  }
  return NextResponse.json({ ok: true, route: "cm-seller-daily", results });
}
