import { NextResponse } from "next/server";
import { buildOAuthHeader } from "@/lib/mkm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function mkmFetchJson(url: string) {
  const headers = buildOAuthHeader("GET", url, "strict", true);
  const res = await fetch(url, { headers, cache: "no-store" });
  const txt = await res.text().catch(() => "");

  const headersObj: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headersObj[k] = v;
  });

  if (!res.ok) {
    throw new Error(
      `MKM ${res.status} @ ${url} :: body=${txt.slice(0, 200)} :: headers=${JSON.stringify(
        headersObj
      )}`
    );
  }

  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(
      `Non-JSON @ ${url} :: body=${txt.slice(0, 200)} :: headers=${JSON.stringify(headersObj)}`
    );
  }
}

export async function GET(req: Request) {
  try {
    const urlReq = new URL(req.url);
    const idOrName = urlReq.searchParams.get("idOrName") ?? "ArcanaFrisia";

    // 🔹 LET OP: GEEN output.json hier, exact zoals in de docs voor /users
    const endpoint = `https://api.cardmarket.com/ws/v2.0/users/${encodeURIComponent(idOrName)}`;
    const data = await mkmFetchJson(endpoint);

    return NextResponse.json({ ok: true, idOrName, data });
  } catch (e: any) {
    console.error("USERS PROBE ERROR:", e?.message ?? e);
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
