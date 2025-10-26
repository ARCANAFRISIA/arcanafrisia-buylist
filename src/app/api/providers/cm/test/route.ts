// src/app/api/providers/cm/test/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

// --- helpers ---
function must(name: string) {
  const v = (process.env[name] ?? "").trim();
  if (!v && name !== "CM_ACCESS_TOKEN" && name !== "CM_ACCESS_SECRET") {
    throw new Error(`Missing env ${name}`);
  }
  return v;
}

// Python-compat OAuth header (zelfde stijl als je werkende Streamlit script)
function oauthHeaderCompat(method: "GET" | "POST", url: string) {
  const APP_TOKEN     = must("CM_APP_TOKEN");
  const APP_SECRET    = must("CM_APP_SECRET");
  const ACCESS_TOKEN  = (process.env.CM_ACCESS_TOKEN  ?? "").trim();
  const ACCESS_SECRET = (process.env.CM_ACCESS_SECRET ?? "").trim();

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: APP_TOKEN,
    oauth_token: ACCESS_TOKEN,
    oauth_nonce: nonce,
    oauth_timestamp: timestamp,
    oauth_signature_method: "HMAC-SHA1",
    oauth_version: "1.0",
  };

  const baseUrl = encodeURIComponent(url);
  const paramStr = Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`)
    .join("&");

  const baseString = `${method}&${baseUrl}&${encodeURIComponent(paramStr)}`;
  const signingKey = `${encodeURIComponent(APP_SECRET)}&${encodeURIComponent(ACCESS_SECRET)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  const header =
    `OAuth realm="${url}", ` +
    Object.entries({ ...oauthParams, oauth_signature: signature })
      .map(([k, v]) => `${k}="${v}"`)
      .join(", ");

  return {
    Authorization: header,
    Accept: "application/json",
    "User-Agent": "ArcanaFrisia-Buylist/1.0",
  };
}

export async function GET() {
  const url = "https://api.cardmarket.com/ws/v2.0/account";
  const res = await fetch(url, { headers: oauthHeaderCompat("GET", url), cache: "no-store" });
  const body = await res.text().catch(() => "");
  return NextResponse.json({ status: res.status, body: body.slice(0, 200) });
}
