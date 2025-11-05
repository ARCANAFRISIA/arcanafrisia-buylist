// src/lib/pricing.ts
import prisma from "@/lib/prisma";

export type PayoutInput = {
  cardmarketId: number; // required
  foil?: boolean; // default false voor nu
};

export type PayoutBreakdown = {
  cmTrend?: number | null;
  ctMin?: number | null;
  basePct: number; // 0.70
  floorPct: number; // 0.70
  rawPrimary?: number | null;
  rawFloor?: number | null;
  chosen: number; // before guards
  chosenAfterGuards: number; // after guards
};

const MIN_PAYOUT_EUR = 0.05;
const CENT = 0.01;
const toNumber = (v: any) => (v == null ? null : Number(v));
const roundToCents = (n: number) => Math.round(n / CENT) * CENT;

export async function calculatePayout(input: PayoutInput): Promise<PayoutBreakdown> {
  const { cardmarketId } = input;

  // CM trend
  const cm = await prisma.cMPriceGuide.findUnique({
    where: { cardmarketId },
    select: { trend: true },
  }).catch(() => null);
  const cmTrend = toNumber(cm?.trend);

  // CT min floor (laatste snapshot via cardmarketId, non-foil). Bucket kan variëren; neem meest recent.
  const ct = await prisma.cTMarketLatest.findFirst({
    where: { cardmarketId, isFoil: false },
    orderBy: { capturedAt: "desc" },
    select: { minPrice: true },
  }).catch(() => null);
  const ctMin = toNumber(ct?.minPrice);

  const basePct = 0.70;
  const floorPct = 0.70;

  const rawPrimary = cmTrend != null ? cmTrend * basePct : null;
  const rawFloor = ctMin != null ? ctMin * floorPct : null;

  let chosen = 0;
  if (rawPrimary == null && rawFloor == null) chosen = 0;
  else if (rawPrimary == null) chosen = rawFloor as number;
  else if (rawFloor == null) chosen = rawPrimary as number;
  else chosen = Math.max(rawPrimary as number, rawFloor as number);

  let chosenAfterGuards = chosen;
  if (chosenAfterGuards > 0 && chosenAfterGuards < MIN_PAYOUT_EUR) chosenAfterGuards = MIN_PAYOUT_EUR;
  if (chosenAfterGuards > 0) chosenAfterGuards = roundToCents(chosenAfterGuards);

  return { cmTrend, ctMin, basePct, floorPct, rawPrimary, rawFloor, chosen, chosenAfterGuards };
}