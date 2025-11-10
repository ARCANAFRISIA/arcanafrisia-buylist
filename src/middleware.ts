import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function isCron(req: NextRequest) {
  const hv = (req.headers.get("x-vercel-cron") || "").trim();
  if (hv === "1") return true;
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  return ua.startsWith("vercel-cron/");
}

function unauthorized() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Admin Area", charset="UTF-8"' },
  });
}

function needsAuth(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (p === "/admin" || p.startsWith("/admin/")) return true;
  if (p.startsWith("/api/submissions/")) {
    const m = req.method.toUpperCase();
    return m === "PUT" || m === "POST" || m === "DELETE" || m === "PATCH";
  }
  return false;
}

function checkBasicAuth(req: NextRequest) {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;
  try {
    const [user, pass] = atob(header.split(" ")[1]).split(":");
    return (
      user === (process.env.ADMIN_USER ?? "") &&
      pass === (process.env.ADMIN_PASS ?? "")
    );
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;

  if (isCron(req)) {
  return NextResponse.next();
}

  // 🔓 BYPASS CM provider endpoints (no auth)
  if (
    p.startsWith("/api/providers/cm/priceguide/fetch") ||
    p.startsWith("/api/providers/cm/test")
  ) {
    return NextResponse.next();
  }
  if (!needsAuth(req)) return NextResponse.next();
  if (!checkBasicAuth(req)) return unauthorized();
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/submissions/:path*"],
};
