const pct = Number(process.env.PRICING_PCT ?? 0.55);           // bv 0.55 = 55%
const minCents = Number(process.env.PRICING_MIN_CENTS ?? 25);  //  €0,25
const maxCents = Number(process.env.PRICING_MAX_CENTS ?? 5000);// €50,00

/**
 * Berekent onze buy-price in centen op basis van trend.
 * Geeft null terug als er geen trend is.
 */
export function quoteCents(opts: {
  trendCents: number | null;
  trendFoilCents?: number | null;
  isFoil?: boolean;
}): number | null {
  const { trendCents, trendFoilCents, isFoil } = opts;

  const base = isFoil ? (trendFoilCents ?? trendCents) : trendCents;
  if (base == null) return null;

  const raw = Math.round(base * pct);
  return Math.max(minCents, Math.min(maxCents, raw));
}
