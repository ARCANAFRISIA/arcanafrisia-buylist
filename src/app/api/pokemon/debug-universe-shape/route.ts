export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import fs from "fs";

const UNIVERSE_PATH =
  process.env.POKEMON_CM_UNIVERSE_PATH ||
  "C:\\Users\\hindr\\Downloads\\cardmarket-pokemon-swsh-to-current-buylist-universe.json";

function keysOf(x: any) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return [];
  return Object.keys(x);
}

export async function GET() {
  try {
    const raw = fs.readFileSync(UNIVERSE_PATH, "utf8");
    const json = JSON.parse(raw);

    const results = Array.isArray(json.results) ? json.results : [];

    return NextResponse.json({
      ok: true,
      topLevelKeys: Object.keys(json),
      resultsType: Array.isArray(json.results) ? "array" : typeof json.results,
      resultsLength: results.length,
      first5ResultKeys: results.slice(0, 5).map((x: any, i: number) => ({
        index: i,
        keys: keysOf(x),
        sample: x,
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 }
    );
  }
}