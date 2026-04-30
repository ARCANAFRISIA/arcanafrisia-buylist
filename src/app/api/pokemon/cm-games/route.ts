import { NextRequest, NextResponse } from "next/server";
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
   OAUTH HELPERS
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

  let baseParams: Record<string, string>;
  if (mode === "compat") {
    baseParams = { ...oauth };
  } else {
    baseParams = { ...oauth };
    u.searchParams.forEach((v, k) => {
      baseParams[k] = v;
    });
  }

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

  const authHeader = withRealm
    ? `${authCore}, realm="${enc3986(url)}"`
    : authCore;

  return {
    Authorization: authHeader,
    Accept: "application/json, application/xml;q=0.9",
    "User-Agent": "ArcanaFrisia-PokemonBuylist/1.0",
  };
}

/* =========================
   FETCH HELPERS
========================= */
async function tryFetch(url: string, headers: Record<string, string>) {
  return fetch(url, {
    headers,
    cache: "no-store",
  });
}

/* =========================
   PARSERS
========================= */
function parseGamesXml(xml: string) {
  const games: Array<{ idGame: number; name: string }> = [];

  const re = /<game>[\s\S]*?<idGame>(\d+)<\/idGame>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/game>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(xml)) !== null) {
    games.push({
      idGame: Number(m[1]),
      name: m[2]
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">"),
    });
  }

  return games;
}

function parseGamesJson(txt: string) {
  const obj = JSON.parse(txt);

  if (Array.isArray(obj?.game)) {
    return obj.game.map((g: any) => ({
      idGame: Number(g.idGame),
      name: String(g.name ?? ""),
    }));
  }

  if (Array.isArray(obj?.games)) {
    return obj.games.map((g: any) => ({
      idGame: Number(g.idGame),
      name: String(g.name ?? ""),
    }));
  }

  if (obj?.game && typeof obj.game === "object") {
    return [
      {
        idGame: Number(obj.game.idGame),
        name: String(obj.game.name ?? ""),
      },
    ];
  }

  return [];
}

/* =========================
   HANDLER
========================= */
export async function GET(req: NextRequest) {
  try {
    const format = (req.nextUrl.searchParams.get("format") || "auto").toLowerCase();

    const urls =
      format === "json"
        ? [
            "https://apiv2.cardmarket.com/ws/v2.0/output.json/games",
            "https://apiv2.cardmarket.com/ws/v2.0/output.json/games",
          ]
        : format === "xml"
        ? [
            "https://apiv2.cardmarket.com/ws/v2.0/games",
            "https://apiv2.cardmarket.com/ws/v2.0/games",
          ]
        : [
            "https://apiv2.cardmarket.com/ws/v2.0/games",
            "https://apiv2.cardmarket.com/ws/v2.0/output.json/games",
            "https://apiv2.cardmarket.com/ws/v2.0/games",
            "https://apiv2.cardmarket.com/ws/v2.0/output.json/games",
          ];

    const attempts: Array<{ url: string; mode: OAuthMode; realm: boolean }> = [];
    for (const url of urls) {
      attempts.push({ url, mode: "compat", realm: true });
      attempts.push({ url, mode: "compat", realm: false });
      attempts.push({ url, mode: "strict", realm: true });
      attempts.push({ url, mode: "strict", realm: false });
    }

    const errors: string[] = [];

    for (const a of attempts) {
      const headers = buildOAuthHeader("GET", a.url, a.mode, a.realm);
      const res = await tryFetch(a.url, headers);
      const ct = res.headers.get("content-type") || "";
      const txt = await res.text().catch(() => "");

      if (!res.ok) {
        errors.push(`[${res.status}] ${a.mode}/${a.realm} @ ${a.url} :: ${txt.slice(0, 200)}`);
        continue;
      }

      try {
        let games: Array<{ idGame: number; name: string }> = [];

        if (ct.includes("json") || txt.trim().startsWith("{")) {
          games = parseGamesJson(txt);
        } else {
          games = parseGamesXml(txt);
        }

        if (!games.length) {
          errors.push(`[${res.status}] parse-empty ${a.mode}/${a.realm} @ ${a.url} :: ${txt.slice(0, 300)}`);
          continue;
        }

        return NextResponse.json({
          ok: true,
          attempt: a,
          contentType: ct,
          totalGames: games.length,
          games,
        });
      } catch (e: any) {
        errors.push(`[${res.status}] parse-fail ${a.mode}/${a.realm} @ ${a.url}: ${e.message}`);
      }
    }

    return NextResponse.json(
      {
        ok: false,
        errors,
      },
      { status: 500 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}