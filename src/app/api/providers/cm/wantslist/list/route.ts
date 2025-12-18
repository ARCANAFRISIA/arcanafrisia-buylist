// src/app/api/providers/cm/wantslist/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildOAuthHeader } from "@/lib/mkm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function mkmFetchJson(url: string, method: "GET" | "POST" = "GET", body?: string) {
  const headers = buildOAuthHeader(method, url, "strict", true);
  if (body) {
    (headers as any)["Content-Type"] = "application/xml; charset=utf-8";
  }
  const res = await fetch(url, {
    method,
    headers,
    body,
    cache: "no-store",
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`MKM ${res.status} @ ${url} :: ${txt.slice(0, 240)}`);
  }
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`Non-JSON @ ${url} :: ${txt.slice(0, 240)}`);
  }
}

export async function GET(_req: NextRequest) {
  try {
    const url = "https://api.cardmarket.com/ws/v2.0/output.json/wantslist";
    const data = await mkmFetchJson(url, "GET");

    // Normaliseer een beetje
    const listsRaw = Array.isArray(data?.wantslist)
      ? data.wantslist
      : Array.isArray(data?.wantslists?.wantslist)
      ? data.wantslists.wantslist
      : [];

    const lists = listsRaw.map((wl: any) => ({
      idWantslist: wl.idWantslist,
      name: wl.name,
      idGame: wl.idGame,
      itemCount: wl.itemCount ?? wl.itemcount ?? 0,
    }));

    return NextResponse.json({ ok: true, count: lists.length, lists });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? String(e) }, { status: 500 });
  }
}
