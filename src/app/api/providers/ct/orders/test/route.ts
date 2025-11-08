import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Gebruik jouw env-namen en voeg /api/v2 toe
const RAW_HOST = process.env.CT_HOST ?? "https://api.cardtrader.com";
const CT_BASE = RAW_HOST.endsWith("/api/v2") ? RAW_HOST : `${RAW_HOST}/api/v2`;
const CT_TOKEN = process.env.CT_TOKEN; // <-- jouw variabele

async function ctFetch(path: string) {
  if (!CT_TOKEN) throw new Error("CT_TOKEN missing (set in .env / Vercel)");
  const res = await fetch(`${CT_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${CT_TOKEN}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CT API ${res.status}: ${body}`);
  }
  return res.json();
}

export async function GET() {
  try {
    const data = await ctFetch("/orders?limit=5&status=completed");
    return NextResponse.json({ ok: true, sample: data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err.message || err) }, { status: 500 });
  }
}
