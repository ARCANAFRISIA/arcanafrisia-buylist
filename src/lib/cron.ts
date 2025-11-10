export function isVercelCron(req: Request | { headers: Headers }) {
  const hv = (req.headers.get("x-vercel-cron") || "").trim();
  if (hv === "1") return true;
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  return ua.startsWith("vercel-cron/");
}
