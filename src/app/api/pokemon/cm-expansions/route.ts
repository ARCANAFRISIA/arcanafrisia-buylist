import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

function must(name: string) {
  const v = (process.env[name] ?? "").trim();
  if (!v && name !== "CM_ACCESS_TOKEN" && name !== "CM_ACCESS_SECRET") {
    throw new Error(`Missing env ${name}`);
  }
  return v;
}

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

function decodeHtml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function fixEncoding(s: string | null) {
  if (!s) return s;
  try {
    return Buffer.from(s, "latin1").toString("utf8");
  } catch {
    return s;
  }
}

function parseXmlExpansions(xml: string) {
  const out: Array<{
    idExpansion: number;
    enName: string | null;
    abbreviation: string | null;
  }> = [];

  const blocks = xml.match(/<expansion>[\s\S]*?<\/expansion>/gi) ?? [];

  for (const block of blocks) {
    const idExpansion = Number(
      block.match(/<idExpansion>(\d+)<\/idExpansion>/i)?.[1] ?? ""
    );

    const enName =
      block.match(/<en>([\s\S]*?)<\/en>/i)?.[1] ??
      block.match(/<name>([\s\S]*?)<\/name>/i)?.[1] ??
      null;

    const abbreviation =
      block.match(/<abbreviation>([\s\S]*?)<\/abbreviation>/i)?.[1] ?? null;

    if (Number.isFinite(idExpansion) && idExpansion > 0) {
      out.push({
        idExpansion,
        enName: enName ? fixEncoding(decodeHtml(enName.trim())) : null,
        abbreviation: abbreviation ? fixEncoding(decodeHtml(abbreviation.trim())) : null,
      });
    }
  }

  return out;
}

function parseJsonExpansions(txt: string) {
  const obj = JSON.parse(txt);
  const raw = Array.isArray(obj?.expansion)
    ? obj.expansion
    : Array.isArray(obj?.expansions)
    ? obj.expansions
    : [];

  return raw.map((x: any) => ({
    idExpansion: Number(x.idExpansion),
    enName: fixEncoding(x?.name?.en ?? x?.en ?? x?.name ?? null),
    abbreviation: fixEncoding(x?.abbreviation ?? null),
  }));
}

export async function GET(req: NextRequest) {
  try {
    const idGame = Number(req.nextUrl.searchParams.get("idGame") || "6");
    const download = req.nextUrl.searchParams.get("download") === "1";
    const all = req.nextUrl.searchParams.get("all") === "1";
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || "50"), 5000);

    const urls = [
      `https://apiv2.cardmarket.com/ws/v2.0/games/${idGame}/expansions`,
      `https://apiv2.cardmarket.com/ws/v2.0/output.json/games/${idGame}/expansions`,
      `https://apiv2.cardmarket.com/ws/v2.0/games/${idGame}/expansions`,
      `https://apiv2.cardmarket.com/ws/v2.0/output.json/games/${idGame}/expansions`,
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
      const res = await fetch(a.url, { headers, cache: "no-store" });
      const ct = res.headers.get("content-type") || "";
      const txt = await res.text().catch(() => "");

      if (!res.ok) {
        errors.push(`[${res.status}] ${a.mode}/${a.realm} @ ${a.url} :: ${txt.slice(0, 200)}`);
        continue;
      }

      try {
        const expansions =
          ct.includes("json") || txt.trim().startsWith("{")
            ? parseJsonExpansions(txt)
            : parseXmlExpansions(txt);

        const payload = {
          ok: true,
          idGame,
          attempt: a,
          contentType: ct,
          total: expansions.length,
          expansions,
        };

        if (download) {
          return new NextResponse(JSON.stringify(payload, null, 2), {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Content-Disposition": `attachment; filename="cardmarket-pokemon-expansions.json"`,
            },
          });
        }

        if (all) {
          return NextResponse.json(payload);
        }

        return NextResponse.json({
          ok: true,
          idGame,
          attempt: a,
          contentType: ct,
          total: expansions.length,
          preview: expansions.slice(0, limit),
        });
      } catch (e: any) {
        errors.push(`[${res.status}] parse-fail ${a.mode}/${a.realm} @ ${a.url}: ${e.message}`);
      }
    }

    return NextResponse.json({ ok: false, idGame, errors }, { status: 500 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}