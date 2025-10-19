import { NextRequest, NextResponse } from "next/server";

const HOST  = process.env.CT_HOST!;
const TOKEN = process.env.CT_TOKEN!;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const u = req.nextUrl.searchParams.get("username");
    if (!u) return NextResponse.json({ error: "username required" }, { status: 400 });

    const url = `${HOST}/api/v2/shipping_methods?username=${encodeURIComponent(u)}`;
    const r   = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const txt = await r.text();

    // Probeer te parsen; als het geen JSON is, geef raw terug.
    let data: any = null;
    try { data = JSON.parse(txt); } catch { /* leave as null */ }

    return NextResponse.json({
      ok: r.ok, status: r.status, username: u,
      parsed: !!data,
      data: data ?? txt
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
