import { NextResponse } from "next/server";
import crypto from "crypto";
import zlib from "zlib";
import prisma from "@/lib/prisma";

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
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

type OAuthMode = "compat" | "strict";
function buildOAuthHeader(method: "GET" | "POST", url: string, mode: OAuthMode, withRealm: boolean) {
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
    baseParams = { ...oauth }; // alleen oauth params
  } else {
    baseParams = { ...oauth };
    u.searchParams.forEach((v, k) => (baseParams[k] = v)); // strict: ook query
  }

  const baseParamsStr = Object.keys(baseParams)
    .sort()
    .map((k) => `${enc3986(k)}=${enc3986(baseParams[k])}`)
    .join("&");

  const baseString = [method, enc3986(u.origin + u.pathname), enc3986(baseParamsStr)].join("&");
  const signingKey = `${enc3986(APP_SECRET)}&${enc3986(ACCESS_SECRET)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams = { ...oauth, oauth_signature: signature };
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
    "User-Agent": "ArcanaFrisia-Buylist/1.0",
  };
}

/* =========================
   FETCH + EXTRACT CSV
========================= */
async function tryFetch(url: string, headers: Record<string, string>) {
  return fetch(url, { headers, cache: "no-store" });
}

function extractCsvFromText(txt: string, contentType: string | null) {
  if ((contentType || "").includes("application/json") || txt.trim().startsWith("{")) {
    const obj = JSON.parse(txt);
    const b64: string = obj.priceguidefile;
    const gz = Buffer.from(b64, "base64");
    return zlib.gunzipSync(gz).toString("utf8");
  }
  const m = txt.match(/<priceguidefile>([^<]+)</i);
  if (m) {
    const gz = Buffer.from(m[1], "base64");
    return zlib.gunzipSync(gz).toString("utf8");
  }
  throw new Error(`Unexpected MKM response (no priceguidefile). First 200: ${txt.slice(0, 200)}`);
}

async function fetchPriceGuideCsv(): Promise<string> {
  const urls = [
    "https://api.cardmarket.com/ws/v2.0/priceguide?idGame=1",
    "https://api.cardmarket.com/ws/v2.0/output.json/priceguide?idGame=1",
    "https://api.cardmarket.com/ws/v2.0/priceguide",
    "https://api.cardmarket.com/ws/v2.0/output.json/priceguide",
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
    const ct = res.headers.get("content-type") || "";
    const txt = await res.text().catch(() => "");

    if (res.ok) {
      try {
        return extractCsvFromText(txt, ct);
      } catch (e: any) {
        errors.push(`[${res.status}] parse-fail ${a.mode}/${a.realm} @ ${a.url}: ${e.message}`);
        continue;
      }
    } else {
      errors.push(`[${res.status}] ${a.mode}/${a.realm} @ ${a.url} :: ${txt.slice(0, 120)}`);
      continue;
    }
  }
  throw new Error(`All MKM priceguide attempts failed:\n${errors.join("\n")}`);
}

/* =========================
   HANDLER: FETCH -> QUEUE
========================= */
export async function GET() {
  try {
    const csv = await fetchPriceGuideCsv();
    const raw = csv.replace(/\r/g, "");
    const lines = raw.split("\n").filter(Boolean);

    // skip header als aanwezig
    const header = lines[0] ?? "";
    const isHeader = /idproduct/i.test(header);
    const rows = isHeader ? lines.slice(1) : lines;

    // Chunked insert in queue
    const CHUNK = 5000;
    let queued = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK).map((line) => ({ line }));
      const res = await prisma.cMPriceGuideQueue.createMany({ data: slice });
      queued += res.count;
    }

    return NextResponse.json({ status: "queued", queued, totalLines: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
