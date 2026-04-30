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
    Accept: "application/json",
    "User-Agent": "ArcanaFrisia-PokemonBuylist/1.0",
  };
}

/* =========================
   TYPES
========================= */
type ParsedProduct = {
  idExpansion: number;
  idProduct: number;
  idMetaproduct: number | null;
  enName: string | null;
  locName: string | null;
  website: string | null;
  image: string | null;
  categoryName: string | null;
  expansionName: string | null;
  number: string | null;
  rarity: string | null;
};

type FetchSinglesResult =
  | {
      ok: true;
      idExpansion: number;
      total: number;
      products: ParsedProduct[];
      rawPreview: string;
      debug: {
        url: string;
        mode: OAuthMode;
        realm: boolean;
        contentType: string;
      };
    }
  | {
      ok: false;
      idExpansion: number;
      errors: string[];
    };

/* =========================
   PARSE HELPERS
========================= */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function pickProductArray(obj: any): any[] {
  if (Array.isArray(obj?.single)) return obj.single;
  if (Array.isArray(obj?.singles)) return obj.singles;

  if (Array.isArray(obj?.product)) return obj.product;
  if (Array.isArray(obj?.products)) return obj.products;

  if (Array.isArray(obj?.expansion?.single)) return obj.expansion.single;
  if (Array.isArray(obj?.expansion?.singles)) return obj.expansion.singles;
  if (Array.isArray(obj?.expansion?.product)) return obj.expansion.product;
  if (Array.isArray(obj?.expansion?.products)) return obj.expansion.products;

  if (Array.isArray(obj?.response?.single)) return obj.response.single;
  if (Array.isArray(obj?.response?.singles)) return obj.response.singles;
  if (Array.isArray(obj?.response?.product)) return obj.response.product;
  if (Array.isArray(obj?.response?.products)) return obj.response.products;

  return [];
}

function parseJsonSingles(txt: string, idExpansion: number): ParsedProduct[] {
  const obj = JSON.parse(txt);
  const rawProducts = pickProductArray(obj);

  return rawProducts
    .map((p: any) => {
      const idProduct = toNum(p?.idProduct);
      if (!idProduct || idProduct <= 0) return null;

      return {
        idExpansion,
        idProduct,
        idMetaproduct: toNum(p?.idMetaproduct),
        enName: toStr(p?.enName),
        locName: toStr(p?.locName),
        website: toStr(p?.website),
        image: toStr(p?.image),
        categoryName: toStr(p?.categoryName),
        expansionName: toStr(p?.expansionName),
        number: toStr(p?.number),
        rarity: toStr(p?.rarity),
      } satisfies ParsedProduct;
    })
    .filter((x): x is ParsedProduct => x !== null);
}

/* =========================
   FETCH SINGLE EXPANSION
========================= */
async function fetchSinglesForExpansion(
  idExpansion: number
): Promise<FetchSinglesResult> {
  const url = `https://apiv2.cardmarket.com/ws/v2.0/output.json/expansions/${idExpansion}/singles`;

  const attempts: Array<{ mode: OAuthMode; realm: boolean }> = [
    { mode: "strict", realm: true },
    { mode: "strict", realm: false },
    { mode: "compat", realm: true },
    { mode: "compat", realm: false },
  ];

  const errors: string[] = [];

  for (const a of attempts) {
    const headers = buildOAuthHeader("GET", url, a.mode, a.realm);
    const res = await fetch(url, {
      headers,
      cache: "no-store",
    });

    const contentType = res.headers.get("content-type") || "";
    const txt = await res.text().catch(() => "");

    if (!res.ok) {
      errors.push(
        `[${res.status}] ${a.mode}/${a.realm} @ ${url} :: ${txt.slice(0, 300)}`
      );
      continue;
    }

    try {
      const products = parseJsonSingles(txt, idExpansion);

      return {
        ok: true,
        idExpansion,
        total: products.length,
        products,
        rawPreview: txt.slice(0, 1500),
        debug: {
          url,
          mode: a.mode,
          realm: a.realm,
          contentType,
        },
      };
    } catch (e: any) {
      errors.push(
        `[${res.status}] parse-fail ${a.mode}/${a.realm} @ ${url}: ${
          e?.message ?? "Unknown parse error"
        }`
      );
    }
  }

  return {
    ok: false,
    idExpansion,
    errors,
  };
}

/* =========================
   HANDLER
========================= */
export async function GET(req: NextRequest) {
  try {
    const idsParam = req.nextUrl.searchParams.get("ids") || "2916,1564";
    const limit = Math.min(
      Number(req.nextUrl.searchParams.get("limit") || "50"),
      500
    );
    const download = req.nextUrl.searchParams.get("download") === "1";
    const includeRaw = req.nextUrl.searchParams.get("raw") === "1";

    const ids = [...new Set(
      idsParam
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x) && x > 0)
    )];

    if (!ids.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "No valid expansion ids supplied.",
        },
        { status: 400 }
      );
    }

    const results: Array<{
      idExpansion: number;
      total: number;
      debug?: FetchSinglesResult extends infer T ? T : never;
    }> = [];

    const errors: Array<{ idExpansion: number; errors: string[] }> = [];
    const rawByExpansion: Record<string, string> = {};
    let allProducts: ParsedProduct[] = [];

    for (const idExpansion of ids) {
      const res = await fetchSinglesForExpansion(idExpansion);

      if (!res.ok) {
        errors.push({
          idExpansion: res.idExpansion,
          errors: res.errors,
        });
        continue;
      }

      results.push({
        idExpansion: res.idExpansion,
        total: res.total,
        debug: res.debug,
      });

      if (includeRaw) {
        rawByExpansion[String(idExpansion)] = res.rawPreview;
      }

      allProducts = allProducts.concat(res.products);
    }

    const payload = {
      ok: errors.length === 0,
      requestedExpansionIds: ids,
      expansionCount: ids.length,
      successfulExpansionCount: results.length,
      failedExpansionCount: errors.length,
      totalProducts: allProducts.length,
      results,
      errors,
      products: allProducts,
      ...(includeRaw ? { rawPreviewByExpansion: rawByExpansion } : {}),
    };

    if (download) {
      return new NextResponse(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="cardmarket-expansion-singles-${ids.join(
            "-"
          )}.json"`,
        },
      });
    }

    return NextResponse.json({
      ok: payload.ok,
      requestedExpansionIds: payload.requestedExpansionIds,
      expansionCount: payload.expansionCount,
      successfulExpansionCount: payload.successfulExpansionCount,
      failedExpansionCount: payload.failedExpansionCount,
      totalProducts: payload.totalProducts,
      results: payload.results,
      errors: payload.errors,
      preview: payload.products.slice(0, limit),
      ...(includeRaw ? { rawPreviewByExpansion: rawByExpansion } : {}),
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