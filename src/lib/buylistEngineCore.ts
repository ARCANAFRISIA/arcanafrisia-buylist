// src/lib/buylistEngineCore.ts

export type CondKey = "NM" | "EX" | "GD" | "LP" | "PL" | "PO";

export type EngineCtx = {
  edhrecRank?: number | null;
  mtgoTix?: number | null;
  recentSales14d?: number | null;
  gameChanger?: boolean | null;
  lowStock?: boolean | null;

  // eigen voorraad in stuks (alle condities/foils samen)
  ownQty?: number | null;

  // NIEUW: setCode (scryfall set code, lowercase)
  setCode?: string | null;
};

export type EngineInput = {
  trend: number | null;
  trendFoil: number | null;
  isFoil: boolean;
  cond: CondKey;
  ctx?: EngineCtx;
};

export type EngineResult = {
  unit: number;
  pct: number;
  usedTrend: number | null;
  allowed: boolean;
};

const MIN_PAYOUT_EUR = 0.35;

// ✅ Premodern + jouw extra (Revised / 3ED)
const PREMODERN_BOOST_SET_CODES = new Set<string>([
  // Core / extras
  "4ed", "5ed", "6ed", "7ed", "chr",
  // Premodern blocks (Ice Age -> Scourge)
  "ice", "hml", "all",
  "mir", "vis", "wth",
  "tmp", "sth", "exo",
  "usg", "ulg", "uds",
  "mmq", "nem", "pcy",
  "inv", "pls", "apc",
  "ody", "tor", "jud",
  "ons", "lgn", "scg",
  // JOUW EXTRA:
  "3ed", // Revised / 3rd Edition
]);

function isPremodernBoostSet(setCode?: string | null) {
  const s = (setCode ?? "").toLowerCase().trim();
  return s ? PREMODERN_BOOST_SET_CODES.has(s) : false;
}

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

export function computeBasePctFromTrend(trend: number | null): number {
  if (trend == null || trend <= 0) return 0;

  if (trend > 75) return 0.75;
  else if (trend > 3) return 0.70;
  else if (trend > 0.75) return 0.65;
  else return 0.65;
}

export function computeUnitFromTrend(input: EngineInput): EngineResult {
  const { trend, trendFoil, isFoil, cond } = input;
  const ctx: EngineCtx = input.ctx ?? {};

  const rawTrend = isFoil ? trendFoil ?? trend : trend;

  if (!rawTrend || rawTrend <= 0) {
    return { unit: 0, pct: 0, usedTrend: null, allowed: false };
  }

  let usedTrend = rawTrend;
  if (isFoil) {
    const discount = rawTrend > 50 ? 0.90 : 0.95;
    usedTrend = rawTrend * discount;
  }

  const cfg = COND_CONFIG[cond] ?? COND_CONFIG.NM;
  if (!cfg.allowed) {
    return { unit: 0, pct: 0, usedTrend, allowed: false };
  }

  // OVERSTOCK-CAP
  const own = ctx.ownQty ?? 0;

  let maxDesired: number;
  if (rawTrend >= 100) maxDesired = 4;
  else if (rawTrend >= 10) maxDesired = 8;
  else maxDesired = 12;

  if (own >= maxDesired) {
    return { unit: 0, pct: 0, usedTrend, allowed: false };
  }

  // minTrend gates
  const rank = ctx.edhrecRank ?? null;
  const tix = ctx.mtgoTix ?? null;

  let minTrend = cfg.baseMinTrend;

  const smallCardBoost =
    (rank != null && rank < 250) ||
    (tix != null && tix > 0.3);

  if (smallCardBoost) {
    minTrend = Math.min(minTrend, 0);
  }

  if (usedTrend < minTrend) {
    return { unit: 0, pct: 0, usedTrend, allowed: false };
  }

  let pct = computeBasePctFromTrend(usedTrend);

  // boosts
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

  if (ctx.gameChanger) bumpTo(0.85);
  if (ctx.recentSales14d != null && ctx.recentSales14d > 3) bumpTo(0.88);
  if (tix != null && tix > 1 && rank != null && rank < 250) bumpTo(0.90);
  if (ctx.lowStock && rank != null && rank < 500) bumpTo(Math.min(pct + 0.02, 0.92));

  const isPremodern = isPremodernBoostSet(ctx.setCode);

  // ✅ Niet-premodern high-end guardrails
  // - > 200 EUR: geen high-end boosts meer, terug naar base pct
  // - > 500 EUR: hard cap op 65%
  if (!isPremodern) {
    if (usedTrend >= 500) {
      pct = 0.65;
    } else if (usedTrend >= 200) {
      pct = computeBasePctFromTrend(usedTrend);
    }
  }

  pct = Math.min(pct, 0.95);

  // unit + condition
  let unit = usedTrend * pct * cfg.mult;

  // ✅ Premodern + Revised boost (10%)
  if (isPremodernBoostSet(ctx.setCode)) {
    unit *= 1.10;

    // ✅ Extra boost op "dure" kaarten (>= 65 EUR) binnen die sets
    if (usedTrend >= 65) {
      unit *= 1.10;
    }
  }

  if (unit < MIN_PAYOUT_EUR) {
    return { unit: 0, pct, usedTrend, allowed: false };
  }

  unit = Math.round(unit * 100) / 100;
  return { unit, pct, usedTrend, allowed: true };
}