// src/lib/pricing.ts
// Server-side pricing utilities (met Prisma), bovenop de pure engine.

import prisma from "@/lib/prisma";
import {
  computeBasePctFromTrend,
  computeUnitFromTrend,
  type CondKey,
} from "./buylistEngineCore";

export type PayoutInput = {
  cardmarketId: number;
  foil?: boolean;
};

export type PayoutBreakdown = {
  cmTrend?: number | null;
  ctMin?: number | null;
  basePct: number;          // baseline% op basis van trend
  chosenPct: number;        // hier gelijk aan basePct (preview = zonder boosters)
  rawUnit: number;          // priceSource × chosenPct
  chosenAfterGuards: number;// afgeronde unit (preview-bedrag)
};

const toNumber = (v: any) => (v == null ? null : Number(v));
const CENT = 0.01;
const roundToCents = (n: number) => Math.round(n / CENT) * CENT;

/**
 * Bestaande calculatePayout() blijft qua signatuur hetzelfde,
 * maar intern gebruiken we nu jouw baseline via computeBasePctFromTrend.
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

  const basePct = computeBasePctFromTrend(priceSource);
  const chosenPct = basePct;

  let rawUnit = priceSource * chosenPct;
  if (rawUnit > 0 && rawUnit < 0.20) rawUnit = 0.20; // zelfde floor
  let chosenAfterGuards = rawUnit > 0 ? roundToCents(rawUnit) : 0;

  return {
    cmTrend,
    ctMin,
    basePct,
    chosenPct,
    rawUnit,
    chosenAfterGuards,
  };
}

// re-export voor server-routes (cart/submit, etc.)
export { computeUnitFromTrend, type CondKey } from "./buylistEngineCore";
