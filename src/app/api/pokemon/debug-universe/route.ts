export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

const UNIVERSE_PATH =
  process.env.POKEMON_CM_UNIVERSE_PATH ||
  "C:\\Users\\hindr\\Downloads\\cardmarket-pokemon-swsh-to-current-buylist-universe.json";

function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("query") ?? "").trim().toLowerCase();
    if (!q) {
      return NextResponse.json({ ok: false, error: "query required" }, { status: 400 });
    }

    const raw = fs.readFileSync(UNIVERSE_PATH, "utf8");
    const json = JSON.parse(raw);

    const rows = (json.results ?? []).filter((row: any) => {
      const name = normalizeText(row.enName ?? row.locName ?? "");
      const set = normalizeText(row.expansionName ?? "");
      const num = String(row.number ?? "").toLowerCase();
      return (
        name.includes(q) ||
        set.includes(q) ||
        num.includes(q)
      );
    });

    return NextResponse.json({
      ok: true,
      query: q,
      count: rows.length,
      sample: rows.slice(0, 100).map((row: any) => ({
        idProduct: row.idProduct ?? null,
        enName: row.enName ?? null,
        expansionName: row.expansionName ?? null,
        number: row.number ?? null,
        rarity: row.rarity ?? null,
        idExpansion: row.idExpansion ?? null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 }
    );
  }
}