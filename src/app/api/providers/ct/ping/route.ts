import { NextResponse } from "next/server";

const RAW_HOST = process.env.CT_HOST ?? "https://api.cardtrader.com";
const CT_BASE = RAW_HOST.endsWith("/api/v2") ? RAW_HOST : `${RAW_HOST}/api/v2`;
const CT_TOKEN = process.env.CT_TOKEN;

export async function GET() {
  if (!CT_TOKEN) return NextResponse.json({ ok: false, msg: "CT_TOKEN missing" });

  const r = await fetch(`${CT_BASE}/info`, {
    headers: { Authorization: `Bearer ${CT_TOKEN}` },
    cache: "no-store",
  });

  const txt = await r.text();
  return NextResponse.json({ ok: r.ok, status: r.status, body: txt.slice(0, 400) });
}
