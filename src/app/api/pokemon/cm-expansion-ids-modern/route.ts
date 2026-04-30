import { NextResponse } from "next/server";
import crypto from "crypto";

/* =========================
   ENV
========================= */
function must(name: string) {
  const v = (process.env[name] ?? "").trim();
  if (!v && name !== "CM_ACCESS_TOKEN" && name !== "CM_ACCESS_SECRET") {
    throw new Error(`Missing env ${name}`);
  }
  return v;
}

/* =========================
   OAUTH
========================= */
function enc3986(s: string) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

type OAuthMode = "compat" | "strict";

function buildOAuthHeader(
  method: "GET" | "POST",
  url: string,
  mode: OAuthMode,
  withRealm: boolean
) {
  const APP_TOKEN = must("CM_APP_TOKEN");
  const APP_SECRET = must("CM_APP_SECRET");
  const ACCESS_TOKEN = (process.env.CM_ACCESS_TOKEN ?? "").trim();
  const ACCESS_SECRET = (process.env.CM_ACCESS_SECRET ?? "").trim();

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const u = new URL(url);

  const oauth: Record<string, string> = {
    oauth_consumer_key: APP_TOKEN,
    oauth_token: ACCESS_TOKEN,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_nonce: nonce,
    oauth_version: "1.0",
  };

  const baseParams: Record<string, string> =
    mode === "strict"
      ? (() => {
          const p = { ...oauth };
          u.searchParams.forEach((v, k) => {
            p[k] = v;
          });
          return p;
        })()
      : { ...oauth };

  const baseParamsStr = Object.keys(baseParams)
    .sort()
    .map((k) => `${enc3986(k)}=${enc3986(baseParams[k])}`)
    .join("&");

  const baseString = [
    method,
    enc3986(u.origin + u.pathname),
    enc3986(baseParamsStr),
  ].join("&");

  const signingKey = `${enc3986(APP_SECRET)}&${enc3986(ACCESS_SECRET)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const headerParams: Record<string, string> = {
    ...oauth,
    oauth_signature: signature,
  };

  const authCore =
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${k}="${enc3986(headerParams[k])}"`)
      .join(", ");

  const authHeader = withRealm ? `${authCore}, realm="${enc3986(url)}"` : authCore;

  return {
    Authorization: authHeader,
    Accept: "application/json",
    "User-Agent": "ArcanaFrisia-PokemonBuylist/1.0",
  };
}

/* =========================
   HELPERS
========================= */
function fixEncoding(s: string | null) {
  if (!s) return s;
  try {
    return Buffer.from(s, "latin1").toString("utf8");
  } catch {
    return s;
  }
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type Expansion = {
  idExpansion: number;
  enName: string | null;
  abbreviation: string | null;
  releaseDate: string | null;
  isReleased: boolean | null;
};

function pickExpansionArray(obj: any): any[] {
  if (Array.isArray(obj?.expansion)) return obj.expansion;
  if (Array.isArray(obj?.expansions)) return obj.expansions;
  if (Array.isArray(obj?.response?.expansion)) return obj.response.expansion;
  if (Array.isArray(obj?.response?.expansions)) return obj.response.expansions;
  return [];
}

function parseJsonExpansions(txt: string): Expansion[] {
  const obj = JSON.parse(txt);
  const raw = pickExpansionArray(obj);

  return raw
    .map((x: any) => {
      const idExpansion = toNum(x?.idExpansion);
      if (!idExpansion || idExpansion <= 0) return null;

      return {
        idExpansion,
        enName: fixEncoding(toStr(x?.enName ?? x?.name?.en ?? x?.name)),
        abbreviation: fixEncoding(toStr(x?.abbreviation)),
        releaseDate: toStr(x?.releaseDate),
        isReleased:
          typeof x?.isReleased === "boolean"
            ? x.isReleased
            : x?.isReleased == null
            ? null
            : String(x.isReleased).toLowerCase() === "true",
      } satisfies Expansion;
    })
    .filter((x): x is Expansion => x !== null);
}

async function fetchPokemonExpansions(): Promise<Expansion[]> {
  const url = "https://apiv2.cardmarket.com/ws/v2.0/output.json/games/6/expansions";
  const attempts: Array<{ mode: OAuthMode; realm: boolean }> = [
    { mode: "strict", realm: true },
    { mode: "strict", realm: false },
    { mode: "compat", realm: true },
    { mode: "compat", realm: false },
  ];

  const errors: string[] = [];

  for (const a of attempts) {
    const headers = buildOAuthHeader("GET", url, a.mode, a.realm);
    const res = await fetch(url, { headers, cache: "no-store" });
    const txt = await res.text().catch(() => "");

    if (!res.ok) {
      errors.push(`[${res.status}] ${a.mode}/${a.realm} :: ${txt.slice(0, 250)}`);
      continue;
    }

    try {
      return parseJsonExpansions(txt);
    } catch (e: any) {
      errors.push(`parse-fail ${a.mode}/${a.realm}: ${e?.message ?? "unknown"}`);
    }
  }

  throw new Error(`Failed to fetch Pokémon expansions:\n${errors.join("\n")}`);
}

/* =========================
   HANDLER
========================= */
export async function GET() {
  try {
    const expansions = await fetchPokemonExpansions();

    // Start at Sword & Shield base and newer
    const cutoff = new Date("2019-11-15T00:00:00+01:00").getTime();

    const modern = expansions
      .filter((e) => {
        if (!e.releaseDate) return false;
        const t = new Date(e.releaseDate).getTime();
        return Number.isFinite(t) && t >= cutoff;
      })
      .sort((a, b) => {
        const ta = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const tb = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return ta - tb;
      });

    const ids = modern.map((e) => e.idExpansion);

    return NextResponse.json({
      ok: true,
      count: ids.length,
      ids,
      expansions: modern,
      downloadUrl: `/api/pokemon/cm-expansion-singles?ids=${ids.join(",")}&download=1`,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}