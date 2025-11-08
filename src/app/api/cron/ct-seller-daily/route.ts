// src/app/api/cron/ct-seller-daily/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const base = `${process.env.NEXT_PUBLIC_BASE_URL || ""}`; // optioneel; relatieve fetch werkt ook
  const url = `/api/providers/ct/orders/sync?states=paid,shipped,hub_pending,hub_shipped,done&limit=100&page=3`;

  const res = await fetch(url, { method: "GET" });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json({ ok: true, route: "ct-seller-daily", result: data });
}
