// src/lib/ct.ts
const HOST  = process.env.CT_HOST!;
const TOKEN = process.env.CT_TOKEN!;
if (!HOST || !TOKEN) throw new Error("CT_HOST/CT_TOKEN missing");

export type CTOffer = {
  id?: number;
  blueprint_id?: number;
  price_cents?: number;
  price?: { cents?: number; currency?: string };
  properties_hash?: Record<string, any>;
  properties?: Record<string, any>;
  user?: {
    username?: string;
    cardtrader_zero?: boolean;
    zero?: boolean;
    // (runtime: we lezen hier soms extra velden uit; typ niet te strikt)
    [k: string]: any;
  };
  cardtrader_zero?: boolean;
  zero?: boolean;
  language?: string;
  condition?: string;
  foil?: boolean;
};

export type NormalizedOffer = {
  price: number;                 // EUR
  cond: "NM" | "EX" | "GD";
  lang: "en";
  foil: boolean;
  seller?: string;
};

// === NIEUW: options-type dat ook door /providers/ct/summary gebruikt kan worden ===
export type CTMarketOptions = {
  zeroOnly?: boolean;                           // default: true
  zeroMode?: "pro" | "probe" | "none";          // default: "pro"
  zeroProbeLimit?: number;                      // default: 8

  // Filters vanuit je API-route:
  allowedConds?: Array<"NM" | "EX" | "GD">;     // default: ["NM","EX","GD"]
  lang?: "en" | null;                           // default: null (geen filter)
  foil?: boolean | null;                        // default: null (geen filter)
};

async function j(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000); // 8s hard timeout
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`);
    return r.json();
  } finally {
    clearTimeout(t);
  }
}



export async function getMarketplaceByBlueprint(blueprintId: number): Promise<CTOffer[]> {
  const data: any = await j(`${HOST}/api/v2/marketplace/products?blueprint_id=${blueprintId}`);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.products)) return data.products;
  return Object.values(data ?? {}).flat() as CTOffer[];
}

// ── helpers ────────────────────────────────────────────────────────────────
function normCond(v: unknown): "NM" | "EX" | "GD" | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "near mint" || s === "nm") return "NM";
  if (s === "slightly played" || s === "sp" || s === "excellent" || s === "ex") return "EX";
  if (
    s === "moderately played" || s === "mp" ||
    s === "played" || s === "poor" || s === "gd" || s === "good"
  ) return "GD";
  return null;
}

function normLang(v: unknown): "en" | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "en" || s === "eng" || s === "english" || s === "us") return "en";
  return null;
}

function pickPrice(o: any): number {
  if (typeof o.price_cents === "number") return o.price_cents / 100;
  if (typeof o?.price?.cents === "number") return o.price.cents / 100;
  if (typeof o.price === "number") return o.price;
  return 0;
}

function hasZeroFlag(o: any): boolean {
  if (o.cardtrader_zero === true) return true;
  if (o.zero === true) return true;
  if (o.user?.cardtrader_zero === true) return true;
  if (o.user?.zero === true) return true;
  return false;
}

// in-memory cache (dev). In productie kun je dit later in Redis stoppen.
const sellerZeroCache = new Map<string, boolean>();

async function isZeroSeller(username: string): Promise<boolean> {
  if (!username) return false;
  if (sellerZeroCache.has(username)) return sellerZeroCache.get(username)!;
  // NB: CT heeft geen native zero-filter → check shipping methods
  const data: any = await j(`${HOST}/api/v2/shipping_methods?username=${encodeURIComponent(username)}`);
  const isZero =
    Array.isArray(data) &&
    data.some((m: any) => typeof m?.name === "string" && m.name.toLowerCase().includes("cardtrader zero"));
  sellerZeroCache.set(username, isZero);
  return isZero;
}
// TEMP: stub voor probe-mode; vervang later door echte check of import.
// Hiermee compileert en runt alles, en 'probe' valt effectief terug op "allowed".
async function isListingZeroEligible(_id: number): Promise<boolean> {
  return true;
}

export async function normalizeCTZeroOffers(
  offers: CTOffer[],
  opts: CTMarketOptions = {}
): Promise<NormalizedOffer[]> {
  const zeroOnly     = opts.zeroOnly !== false;              // default: true
  const zeroMode     = opts.zeroMode ?? "pro";               // default: PRO-filter
  const probeLimit   = opts.zeroProbeLimit ?? 8;
  const allowedConds = (opts.allowedConds?.length
    ? opts.allowedConds
    : (["NM", "EX", "GD"] as Array<"NM" | "EX" | "GD">));
  const langFilter   = opts.lang ?? null;                    // null = geen filter
  const foilFilter   = (typeof opts.foil === "boolean" ? opts.foil : null); // null = geen filter

  // sorteer goedkoop→duur (handig voor probe)
  const sorted = offers.slice().sort((a, b) =>
    (a.price_cents ?? a?.price?.cents ?? 0) - (b.price_cents ?? b?.price?.cents ?? 0)
  );

    // optioneel: vendor-probe voor goedkoopste N (geen cart call, alleen seller zero-check)
  const probeResult = new Map<number, boolean>();
  if (zeroOnly && zeroMode === "probe") {
    let tested = 0;
    for (const o of sorted) {
      const id = o.id;
      if (!id || tested >= probeLimit) break;
      const sellerName = o.user?.username?.trim() || "";
      const ok = sellerName ? await isZeroSeller(sellerName) : false;
      probeResult.set(id, ok);
      tested++;
    }
  }


  const out: NormalizedOffer[] = [];
  for (const o of offers) {
    const seller = (o.user ?? {}) as any;

    // ----- Zero-eligibility heuristiek -----
    let isZeroLike = true; // als zeroOnly=false maakt het niet uit
          if (zeroOnly) {
  if (zeroMode === "probe" && probeResult.has(o.id!)) {
    // PROBE: we hebben seller via isZeroSeller() gecheckt in het "probe" blok
    isZeroLike = probeResult.get(o.id!)!;
  } else if (zeroMode === "pro") {
    // PRO: SNEL! GEEN extra API-calls per offer
    const isPro  = seller.user_type === "pro";
    const hub    = seller.can_sell_via_hub === true;
    const sealCT = seller.can_sell_sealed_with_ct_zero === true;
    const zeroFlag = hasZeroFlag(o); // alleen lokale flags, geen fetch
    isZeroLike = isPro || hub || sealCT || zeroFlag;
  } else {
    // "none": geen filter
    isZeroLike = true;
  }
}

    if (zeroOnly && !isZeroLike) continue;

    // ----- rest: cond/lang/foil/price -----
    const props = (o.properties_hash ?? o.properties ?? {}) as any;
    const cond  = normCond(props.condition ?? o.condition);
    if (!cond) continue;

    const lang  = normLang(props.mtg_language ?? props.language ?? o.language ?? "en");
    if (!lang) continue;

    const foil  = Boolean(props.mtg_foil ?? props.foil ?? o.foil);
    const price = pickPrice(o);
    if (!price || price <= 0) continue;

    // === NIEUW: filters toepassen ===
    if (!allowedConds.includes(cond)) continue;
    if (langFilter && lang !== langFilter) continue;
    if (foilFilter !== null && foil !== foilFilter) continue;

    out.push({ price, cond, lang: "en", foil, seller: seller.username?.trim() });
  }
  return out;
}

// NB: verwacht helper bestaat elders. Als niet, stub tijdelijk:
// async function isListingZeroEligible(id: number): Promise<boolean> { return true; }
