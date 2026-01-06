// src/lib/buylistEngineCore.ts

export type CondKey = "NM" | "EX" | "GD" | "LP" | "PL" | "PO";

export type EngineCtx = {
  edhrecRank?: number | null;
  mtgoTix?: number | null;
  recentSales14d?: number | null;
  gameChanger?: boolean | null;
  lowStock?: boolean | null;

  // NIEUW: eigen voorraad in stuks (alle condities/foils samen)
  ownQty?: number | null;
};

export type EngineInput = {
  trend: number | null;
  trendFoil: number | null;
  isFoil: boolean;
  cond: CondKey;
  ctx?: EngineCtx;
};

export type EngineResult = {
  unit: number;            // uiteindelijke uitbetaling per stuk in EUR
  pct: number;             // payout% op gebruikte trend, vóór conditiemultiplier
  usedTrend: number | null;// trend na foil-discount
  allowed: boolean;        // of we deze kaart überhaupt kopen
};

const MIN_PAYOUT_EUR = 0.35;

const COND_CONFIG: Record<
  CondKey,
  { mult: number; baseMinTrend: number; allowed: boolean }
> = {
  NM: { mult: 1.0, baseMinTrend: 0.75, allowed: true },
  EX: { mult: 1.0, baseMinTrend: 0.75, allowed: true },
  GD: { mult: 0.9, baseMinTrend: 3.0, allowed: true },
  LP: { mult: 0.8, baseMinTrend: 10.0, allowed: true },
  PL: { mult: 0.7, baseMinTrend: Number.POSITIVE_INFINITY, allowed: false },
  PO: { mult: 0.5, baseMinTrend: Number.POSITIVE_INFINITY, allowed: false },
};

// Basis payout% alleen op basis van trend-range (zonder boosts)
// Wordt ook gebruikt door andere modules (pricing.ts) voor transparante referenties.
export function computeBasePctFromTrend(trend: number | null): number {
  if (trend == null || trend <= 0) return 0;

  if (trend > 75) {
    return 0.75;
  } else if (trend > 3) {
    return 0.70;
  } else if (trend > 0.75) {
    return 0.65;
  } else {
    // hier komen alleen uitzonderingen (<0.75) door small-card-boost-achtige dingen
    return 0.65;
  }
}


export function computeUnitFromTrend(input: EngineInput): EngineResult {
  const { trend, trendFoil, isFoil, cond } = input;
  const ctx: EngineCtx = input.ctx ?? {};

  // 1️⃣ ruwe trend kiezen (foil als die er is, anders non-foil)
  const rawTrend = isFoil ? trendFoil ?? trend : trend;

  if (!rawTrend || rawTrend <= 0) {
    return { unit: 0, pct: 0, usedTrend: null, allowed: false };
  }

  // 2️⃣ foil-discount toepassen
  let usedTrend = rawTrend;
  if (isFoil) {
    const discount = rawTrend > 50 ? 0.90 : 0.95; // >50€ → -10%, anders -5%
    usedTrend = rawTrend * discount;
  }

  // 3️⃣ conditie-config
  const cfg = COND_CONFIG[cond] ?? COND_CONFIG.NM;
  if (!cfg.allowed) {
    return { unit: 0, pct: 0, usedTrend, allowed: false };
  }

  // 3b️⃣ OVERSTOCK-CAP op basis van ownQty
  // - default: max 12 copies
  // - vanaf 10€: max 8 copies
  // - vanaf 100€: max 4 copies
  const own = ctx.ownQty ?? 0;

  let maxDesired: number;
  if (rawTrend >= 100) maxDesired = 4;
  else if (rawTrend >= 10) maxDesired = 8;
  else maxDesired = 12;

  if (own >= maxDesired) {
    // we hebben al genoeg → niet meer inkopen
    return { unit: 0, pct: 0, usedTrend, allowed: false };
  }

  // 4️⃣ globale "we kopen niet onder 0,75" – maar EDHREC/tix kunnen dat versoepelen
  const rank = ctx.edhrecRank ?? null;
  const tix = ctx.mtgoTix ?? null;

  let minTrend = cfg.baseMinTrend;

  const smallCardBoost =
    (rank != null && rank < 250) ||
    (tix != null && tix > 0.3);

  if (smallCardBoost) {
    minTrend = Math.min(minTrend, 0); // kan onder 0.75 zakken
  }

  if (usedTrend < minTrend) {
    return { unit: 0, pct: 0, usedTrend, allowed: false };
  }

  // 5️⃣ basis payout% op basis van prijsrange
  
  let pct = computeBasePctFromTrend(usedTrend);


  // 6️⃣ boosts (EDHREC / tix / staples / velocity)
  const bumpTo = (target: number) => {
    if (target > pct) pct = target;
  };

  if (rank != null) {
    if (rank < 200) bumpTo(0.90);
    else if (rank < 500) bumpTo(0.80);
  }

  if (tix != null) {
    if (tix > 3) bumpTo(0.85);
    else if (tix > 0.3) bumpTo(0.80);
  }

  if (ctx.gameChanger) {
    bumpTo(0.85);
  }

  if (ctx.recentSales14d != null && ctx.recentSales14d > 3) {
    bumpTo(0.88);
  }

  if (tix != null && tix > 1 && rank != null && rank < 250) {
    bumpTo(0.90);
  }

  if (ctx.lowStock && rank != null && rank < 500) {
    bumpTo(Math.min(pct + 0.02, 0.92));
  }

  // absolute cap – we willen nooit richting 100%
  pct = Math.min(pct, 0.95);

  // 7️⃣ unit berekenen + conditie-multiplier
  let unit = usedTrend * pct * cfg.mult;

  if (unit < MIN_PAYOUT_EUR) {
    return { unit: 0, pct, usedTrend, allowed: false };
  }

  unit = Math.round(unit * 100) / 100;

  return { unit, pct, usedTrend, allowed: true };
}
