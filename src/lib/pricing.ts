// src/lib/pricing.ts
// Server-side pricing utilities (met Prisma), bovenop de pure engine.

import prisma from "@/lib/prisma";

// Re-export van de pure engine (zodat server-routes deze via hier kunnen pakken)
export { computeUnitFromTrend, type CondKey } from "./buylistEngineCore";

export type PayoutInput = {
  cardmarketId: number;
  foil?: boolean;
};

export type PayoutBreakdown = {
  cmTrend?: number | null;
  ctMin?: number | null;
  basePct: number;           // baseline% op basis van trend
  chosenPct: number;         // hier gelijk aan basePct (preview = zonder boosters)
  rawUnit: number;           // priceSource × chosenPct
  chosenAfterGuards: number; // afgeronde unit (preview-bedrag)
};

const toNumber = (v: any) => (v == null ? null : Number(v));
const CENT = 0.01;
const roundToCents = (n: number) => Math.round(n / CENT) * CENT;

/**
 * Lokale helper: baseline payout% op basis van CM-trend.
 * Dit is grofweg hetzelfde als de range-logica in de engine vóór de boosts.
 */
function computeBasePctFromTrendLocal(trend: number): number {
  if (!Number.isFinite(trend) || trend <= 0) return 0;

  if (trend > 75) return 0.75;
  if (trend > 3) return 0.70;
  if (trend > 0.75) return 0.65;

  // hier komen alleen uitzonderingen (<0.75) terecht
  return 0.65;
}

/**
 * Bestaande calculatePayout() blijft qua signatuur hetzelfde,
 * maar gebruikt nu de lokale baseline-helper.
 * - Gaat uit van NM, non-foil, zonder boosters.
 * - Wordt nu alleen nog gebruikt als fallback / voor oude callers.
 */
export async function calculatePayout(
  input: PayoutInput
): Promise<PayoutBreakdown> {
  const { cardmarketId } = input;

  // CM trend
  const cm = await prisma.cMPriceGuide
    .findUnique({
      where: { cardmarketId },
      select: { trend: true },
    })
    .catch(() => null);
  const cmTrend = toNumber(cm?.trend);

  // CT min als fallback
  const ct = await prisma.cTMarketLatest
    .findFirst({
      where: { cardmarketId, isFoil: false },
      orderBy: { capturedAt: "desc" },
      select: { minPrice: true },
    })
    .catch(() => null);
  const ctMin = toNumber(ct?.minPrice);

  const priceSource = cmTrend ?? ctMin ?? null;
  if (priceSource == null || priceSource <= 0) {
    return {
      cmTrend,
      ctMin,
      basePct: 0,
      chosenPct: 0,
      rawUnit: 0,
      chosenAfterGuards: 0,
    };
  }

  const basePct = computeBasePctFromTrendLocal(priceSource);
  const chosenPct = basePct;

  let rawUnit = priceSource * chosenPct;

  // Zelfde floor (0,20 EUR) als in de engine
  if (rawUnit > 0 && rawUnit < 0.20) rawUnit = 0.20;

  const chosenAfterGuards = rawUnit > 0 ? roundToCents(rawUnit) : 0;

  return {
    cmTrend,
    ctMin,
    basePct,
    chosenPct,
    rawUnit,
    chosenAfterGuards,
  };
}
