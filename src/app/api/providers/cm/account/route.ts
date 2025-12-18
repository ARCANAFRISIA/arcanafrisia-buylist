import { NextResponse } from "next/server";
import { buildOAuthHeader, type OAuthMode } from "@/lib/mkm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function mkmJsonRequest(
  method: "GET" | "POST",
  url: string
) {
  const attempts: Array<{ mode: OAuthMode; realm: boolean }> = [
    { mode: "compat", realm: true },
    { mode: "compat", realm: false },
    { mode: "strict", realm: true },
    { mode: "strict", realm: false },
  ];

  const errors: string[] = [];

  for (const a of attempts) {
    try {
      const headers = buildOAuthHeader(method, url, a.mode, a.realm);
      const res = await fetch(url, { method, headers, cache: "no-store" });
      const raw = await res.text().catch(() => "");

      if (res.ok) {
        try {
          return JSON.parse(raw);
        } catch (e: any) {
          errors.push(
            `[${res.status}] parse-fail ${a.mode}/${a.realm} @ ${url}: ${e?.message ?? "parse error"}`
          );
          continue;
        }
      } else {
        errors.push(
          `[${res.status}] ${a.mode}/${a.realm} @ ${url} :: ${raw.slice(
            0,
            200
          )}`
        );
        continue;
      }
    } catch (e: any) {
      errors.push(`throw ${a.mode}/${a.realm} @ ${url}: ${e?.message ?? e}`);
      continue;
    }
  }

  throw new Error(
    `All MKM account attempts failed for ${method} ${url}:\n` +
      errors.join("\n")
  );
}

export async function GET() {
  try {
    const url = "https://api.cardmarket.com/ws/v2.0/output.json/account";
    const data = await mkmJsonRequest("GET", url);

    const acc = data.account;
    if (!acc) {
      return NextResponse.json(
        { error: "No account object in response", raw: data },
        { status: 500 }
      );
    }

    return NextResponse.json({
      idUser: acc.idUser,
      username: acc.username,
      country: acc.country,
      maySell: acc.maySell,
      sellerActivation: acc.sellerActivation,
      isCommercial: acc.isCommercial,
      // alles eromheen is ook beschikbaar, maar dit is genoeg voor nu
    });
  } catch (err: any) {
    console.error("ACCOUNT ROUTE ERROR:", err?.message ?? err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
