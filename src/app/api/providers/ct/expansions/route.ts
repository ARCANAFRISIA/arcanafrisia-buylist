import { NextResponse } from "next/server";

const HOST = process.env.CT_HOST!;
const TOKEN = process.env.CT_TOKEN!;
const MTG_GAME_ID = 1;

async function j(url: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`);
  return r.json();
}

export const dynamic = "force-dynamic";

export async function GET() {
  if (!HOST || !TOKEN) {
    return NextResponse.json({ ok:false, error:"CT_HOST/CT_TOKEN missing" }, { status: 500 });
  }
  const exps: any[] = await j(`${HOST}/api/v2/expansions`);
  const mtg = (exps || []).filter(e => !e.game_id || e.game_id === MTG_GAME_ID);
  // Geef compacte info terug
  return NextResponse.json({
    ok: true,
    count: mtg.length,
    expansions: mtg.map(e => ({ id: e.id, name: e.name, code: e.code, released_at: e.released_at }))
  });
}
