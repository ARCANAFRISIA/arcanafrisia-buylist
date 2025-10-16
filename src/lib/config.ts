// src/lib/config.ts
export function getPayoutPct(): number {
  const raw = process.env.PAYOUT_PCT;
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1) return 0.70; // default 70%
  return n;
}
