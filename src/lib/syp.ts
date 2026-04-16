// src/lib/syp.ts

export type SypPhase = "release" | "stabilized" | "mature";

export type ActiveSetConfig = {
  set: string;
  phase: SypPhase;
};

export const ACTIVE_SETS: ActiveSetConfig[] = [
  { set: "sos", phase: "release" },
  { set: "soc", phase: "release" },

  { set: "tmt", phase: "stabilized" },
  { set: "tmc", phase: "stabilized" },
  { set: "ecc", phase: "stabilized" },
  { set: "tla", phase: "stabilized" },
  { set: "drc", phase: "stabilized" },
];

/**
 * Premodern / old.
 * Pas deze lijst aan op jouw definitieve businesskeuze.
 */
export const PREMODERN_SET_CODES = [
  "4ed",
  "ice",
  "chr",
  "hml",
  "all",
  "mir",
  "vis",
  "5ed",
  "wth",
  "tmp",
  "sth",
  "exo",
  "usg",
  "ulg",
  "uds",
  "6ed",
  "mmq",
  "nem",
  "pcy",
  "inv",
  "pls",
  "apc",
  "7ed",
  "ody",
  "tor",
  "jud",
  "ons",
  "lgn",
  "scg",
] as const;

export function getEffectiveTix(input: unknown): number {
  const n = Number(input ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function getPriceEur(input: unknown): number {
  const n = Number(input ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function getQtyOnHand(input: unknown): number {
  const n = Number(input ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function getTargetQty(args: {
  tix: number;
  price: number;
  phase: SypPhase;
}): number {
  const tix = Number(args.tix ?? 0);
  const price = Number(args.price ?? 0);
  const phase = args.phase;

  if (phase === "release") {
    if (tix > 1) return 12;
    if (tix > 0.3) return 8;
    if (price > 0.35) return 4;
    return 0;
  }

  if (phase === "stabilized") {
    if (tix > 1) return 8;
    if (tix > 0.3) return 4;
    if (price > 0.35) return 2;
    return 0;
  }

  if (phase === "mature") {
    if (price > 300) return 1;
    if (price > 100) return 2;
    if (tix > 1) return 2;
    if (tix > 0.3) return 1;
    if (price > 0.35) return 0;
    return 0;
  }

  return 0;
}

export function getNeededQty(targetQty: number, qtyOnHand: number): number {
  return Math.max(0, Math.floor(targetQty) - Math.floor(qtyOnHand));
}

export function getMinListQtyFromTix(tix: number): number {
  if (tix > 1) return 4;
  if (tix > 0.3) return 2;
  return 1;
}