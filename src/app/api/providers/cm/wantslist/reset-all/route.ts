// src/app/api/providers/cm/wantslist/reset-all/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { buildOAuthHeader } from "@/lib/mkm";

type Method = "GET" | "DELETE";

async function mkmRequest(method: Method, url: string, body?: string) {
  const headers: Record<string, string> = buildOAuthHeader(
    method as "GET" | "POST",
    url,
    "strict",
    true
  );
  if (body) {
    headers["Content-Type"] = "application/xml; charset=utf-8";
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
    cache: "no-store",
  });

    const text = await res.text().catch(() => "");

  // Headers omzetten naar een gewoon object zonder entries()
  const headersObj: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  return { res, ok: res.ok, status: res.status, text, headers: headersObj };
}



export async function POST() {
  try {
    // 1) Alle wantslists ophalen (JSON-variant)
    const listUrl = "https://api.cardmarket.com/ws/v2.0/output.json/wantslist";
    const listResp = await mkmRequest("GET", listUrl);

    if (!listResp.ok) {
      throw new Error(
        `Failed to list wantslists: ${listResp.status} :: ${listResp.text.slice(
          0,
          200
        )}`
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(listResp.text);
    } catch {
      throw new Error(
        `Non-JSON wantslist response: ${listResp.text.slice(0, 200)}`
      );
    }

    const raw = parsed.wantslist;
    const lists: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

    const results: Array<{
      id: number | string;
      name: string | null;
      itemCount: number | null;
      status: number;
      ok: boolean;
      snippet: string;
    }> = [];

    // 2) Elke wantslist deleten
    for (const wl of lists) {
      const id =
        wl.idWantslist ??
        wl.idWantsList ??
        wl.idWishlist ??
        wl.id ??
        null;
      if (!id) continue;

      const name = wl.name ?? wl.wantslistName ?? null;
      const itemCount =
        typeof wl.itemCount === "number" ? wl.itemCount : null;

      const deleteUrl = `https://api.cardmarket.com/ws/v2.0/wantslist/${id}`;
      const delResp = await mkmRequest("DELETE", deleteUrl);

      results.push({
        id,
        name,
        itemCount,
        status: delResp.status,
        ok: delResp.ok,
        snippet: delResp.text.slice(0, 200),
      });

      // kleine pauze ivm rate-limits
      await new Promise((r) => setTimeout(r, 250));
    }

    return NextResponse.json({
      ok: true,
      totalLists: lists.length,
      deletedOk: results.filter((r) => r.ok).length,
      results,
    });
  } catch (e: any) {
    console.error("RESET WANTSLISTS ERROR:", e);
    return NextResponse.json(
      { ok: false, error: e.message ?? String(e) },
      { status: 500 }
    );
  }
}
