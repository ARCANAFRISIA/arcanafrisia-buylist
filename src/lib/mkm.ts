// src/lib/mkm.ts
import crypto from "crypto";

export function must(name: string) {
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

export type OAuthMode = "compat" | "strict";

/** Bouwt de OAuth 1.0 header zoals je al gebruikte bij de priceguide. */
export function buildOAuthHeader(
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
    u.searchParams.forEach((v, k) => (baseParams[k] = v));
  }

  const baseParamsStr = Object.keys(baseParams)
    .sort()
    .map((k) => `${enc3986(k)}=${enc3986(baseParams[k])}`)
    .join("&");

  const baseString = [method, enc3986(u.origin + u.pathname), enc3986(baseParamsStr)].join("&");
  const signingKey = `${enc3986(APP_SECRET)}&${enc3986(ACCESS_SECRET)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams: Record<string, string> = { ...oauth, oauth_signature: signature };
  const authCore =
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${k}="${enc3986(headerParams[k as keyof typeof headerParams])}"`)
      .join(", ");

  const authHeader = withRealm ? `${authCore}, realm="${enc3986(url)}"` : authCore;

  return {
    Authorization: authHeader,
    Accept: "application/json, application/xml;q=0.9",
    "User-Agent": "ArcanaFrisia-Buylist/1.0",
  };
}
