export type CM = {
  trend: number | null
  foilTrend: number | null
  lowEx: number | null
  suggested: number | null
  germanProLow: number | null
  avg7: number | null
  avg30: number | null
  foilAvg7: number | null
  foilAvg30: number | null
};

export function computePayoutCmix(opts: {
  cm: CM
  ctMinPrice: number | null
  isFoil: boolean
}) {
  const { cm, ctMinPrice, isFoil } = opts;

  const trend = isFoil ? cm.foilTrend : cm.trend;
  const lowEx = cm.lowEx;

  // 1️⃣ Primaire basis
  const base = trend != null ? 0.70 * trend : null;

  // 2️⃣ Safety net voor spikes of missende trend
  const ctFloor = ctMinPrice != null ? 0.70 * ctMinPrice : null;

  // 3️⃣ LowEx — alleen als logisch vergeleken met trend
  let lowExMix: number | null = null;
  if (lowEx != null && trend != null) {
    if (lowEx >= 0.60 * trend && lowEx <= 1.30 * trend) {
      lowExMix = 0.65 * lowEx;
    }
  }

  // 4️⃣ Beste waarde kiezen
  const candidates = [base, ctFloor, lowExMix].filter((x): x is number => x != null);
  let payout = candidates.length ? Math.max(...candidates) : 0;

  // 5️⃣ Momentum pricing (AVG7 vs AVG30)
  const a7   = isFoil ? cm.foilAvg7  : cm.avg7;
  const a30  = isFoil ? cm.foilAvg30 : cm.avg30;
  if (a7 && a30 && a30 > 0) {
    const rel = (a7 - a30) / a30;
    const clamp = Math.max(-0.05, Math.min(0.07, rel)); // -5%/+7% max
    payout *= (1 + clamp);
  }

  // 6️⃣ Guardrails
  payout = Math.max(0.05, payout);
  payout = Math.round(payout * 100) / 100;

  return payout;
}
