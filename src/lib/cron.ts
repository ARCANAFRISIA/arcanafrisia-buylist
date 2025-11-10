// src/lib/cron.ts
export function isVercelCron(req: Request | { headers: Headers }) {
  const h = req.headers;
  const hv = (h.get("x-vercel-cron") || "").trim();
  if (hv === "1") return true;
  const ua = (h.get("user-agent") || "").toLowerCase();
  // Vercel scheduled invocations (en “Run” in dashboard) sturen vaak deze UA:
  // vercel-cron/1.0 (+https://vercel.com/docs/cron-jobs)
  if (ua.startsWith("vercel-cron/")) return true;
  return false;
}
