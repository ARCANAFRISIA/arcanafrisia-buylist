import { NextResponse } from "next/server";
import crypto from "crypto";
import zlib from "zlib";

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

  const authHeader = withRealm ? `${authCore}, realm="${enc3986(url)}"` : authCore;

  return {
    Authorization: authHeader,
    Accept: "application/json, application/xml;q=0.9",
    "User-Agent": "ArcanaFrisia-PokemonBuylist/1.0",
  };
}

/* =========================
   FETCH + EXTRACT CSV
========================= */
async function tryFetch(url: string, headers: Record<string, string>) {
  return fetch(url, {
    headers,
    cache: "no-store",
  });
}

function extractCsvFromText(txt: string, contentType: string | null) {
  if ((contentType || "").includes("application/json") || txt.trim().startsWith("{")) {
    const obj = JSON.parse(txt);
    const b64: string = obj.priceguidefile;
    if (!b64) {
      throw new Error(`JSON response has no priceguidefile. First 200: ${txt.slice(0, 200)}`);
    }
    const gz = Buffer.from(b64, "base64");
    return zlib.gunzipSync(gz).toString("utf8");
  }

  const m = txt.match(/<priceguidefile>([^<]+)</i);
  if (m) {
    const gz = Buffer.from(m[1], "base64");
    return zlib.gunzipSync(gz).toString("utf8");
  }

  throw new Error(`Unexpected Cardmarket response (no priceguidefile). First 200: ${txt.slice(0, 200)}`);
}

async function fetchPriceGuideCsvPokemon(): Promise<{
  csv: string;
  debug: {
    url: string;
    mode: OAuthMode;
    realm: boolean;
    contentType: string;
  };
}> {
  const urls = [
    "https://apiv2.cardmarket.com/ws/v2.0/priceguide?idGame=6",
    "https://apiv2.cardmarket.com/ws/v2.0/output.json/priceguide?idGame=6",
    "https://apiv2.cardmarket.com/ws/v2.0/priceguide?idGame=6",
    "https://apiv2.cardmarket.com/ws/v2.0/output.json/priceguide?idGame=6",
  ] as const;

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
    const contentType = res.headers.get("content-type") || "";
    const txt = await res.text().catch(() => "");

    if (res.ok) {
      try {
        const csv = extractCsvFromText(txt, contentType);
        return {
          csv,
          debug: {
            url: a.url,
            mode: a.mode,
            realm: a.realm,
            contentType,
          },
        };
      } catch (e: any) {
        errors.push(`[${res.status}] parse-fail ${a.mode}/${a.realm} @ ${a.url}: ${e.message}`);
        continue;
      }
    } else {
      errors.push(`[${res.status}] ${a.mode}/${a.realm} @ ${a.url} :: ${txt.slice(0, 180)}`);
    }
  }

  throw new Error(`All Pokémon priceguide attempts failed:\n${errors.join("\n")}`);
}

/* =========================
   CSV PARSER
========================= */
function clean(s: string) {
  return s.trim().replace(/^"|"$/g, "");
}

function numFrom(cols: string[], i: number) {
  const v = clean(cols[i] ?? "");
  if (!v) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parsePokemonRow(line: string) {
  const delim = line.includes(";") ? ";" : ",";
  const cols = line.split(delim);

  const idProduct = Number(clean(cols[0] ?? ""));
  if (!Number.isFinite(idProduct) || idProduct <= 0) return null;

  return {
    raw: line,
    delimiter: delim,
    idProduct,
    columnCount: cols.length,
    avgSell: numFrom(cols, 1),
    lowPrice: numFrom(cols, 2),
    trendPrice: numFrom(cols, 3),
    germanProLow: numFrom(cols, 4),
    suggestedPrice: numFrom(cols, 5),
    foilSell: numFrom(cols, 6),
    foilLow: numFrom(cols, 7),
    foilTrend: numFrom(cols, 8),
    lowPriceExPlus: numFrom(cols, 9),
    avg1: numFrom(cols, 10),
    avg7: numFrom(cols, 11),
    avg30: numFrom(cols, 12),
    foilAvg1: numFrom(cols, 13),
    foilAvg7: numFrom(cols, 14),
    foilAvg30: numFrom(cols, 15),
    cols,
  };
}

/* =========================
   HANDLER
========================= */
export async function GET() {
  try {
    const { csv, debug } = await fetchPriceGuideCsvPokemon();

    const raw = csv.replace(/\r/g, "");
    const lines = raw.split("\n").filter(Boolean);

    const header = lines[0] ?? "";
    const isHeader = /idproduct/i.test(header);
    const rows = isHeader ? lines.slice(1) : lines;

    const preview = rows.slice(0, 10).map((line, index) => ({
      index,
      parsed: parsePokemonRow(line),
    }));

    return NextResponse.json({
      ok: true,
      game: 6,
      debug,
      totalLines: rows.length,
      hasHeader: isHeader,
      header: isHeader ? header : null,
      firstRawLine: rows[0] ?? null,
      previewCount: preview.length,
      preview,
    });
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