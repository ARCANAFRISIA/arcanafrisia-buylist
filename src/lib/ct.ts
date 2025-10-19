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
  user?: { username?: string; cardtrader_zero?: boolean; zero?: boolean };
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

async function j(url: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`);
  return r.json();
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


export async function normalizeCTZeroOffers(
  offers: CTOffer[],
  opts: { zeroOnly?: boolean; zeroMode?: "pro" | "probe" | "none"; zeroProbeLimit?: number } = {}
): Promise<NormalizedOffer[]> {
  const zeroOnly   = opts.zeroOnly !== false;           // default: true
  const zeroMode   = opts.zeroMode ?? "pro";            // default: PRO-filter
  const probeLimit = opts.zeroProbeLimit ?? 8;

  // sorteer goedkoop→duur (handig voor probe)
  const sorted = offers.slice().sort((a, b) =>
    (a.price_cents ?? a?.price?.cents ?? 0) - (b.price_cents ?? b?.price?.cents ?? 0)
  );

  // optioneel: cart-probe voor goedkoopste N
  const probeResult = new Map<number, boolean>();
  if (zeroOnly && zeroMode === "probe") {
    let tested = 0;
    for (const o of sorted) {
      const id = o.id;
      if (!id || tested >= probeLimit) break;
      const ok = await isListingZeroEligible(id); // uit ct-zero-check.ts (optioneel)
      probeResult.set(id, ok);
      tested++;
    }
  }

  const out: NormalizedOffer[] = [];
  for (const o of offers) {
    const seller = o.user ?? {};
    const sellerName = seller.username?.trim();

    // ----- Zero-eligibility heuristiek -----
    let isZeroLike = true; // als zeroOnly=false maakt het niet uit
    if (zeroOnly) {
      if (zeroMode === "probe" && probeResult.has(o.id!)) {
        isZeroLike = probeResult.get(o.id!)!;
      } else if (zeroMode === "pro") {
        // PRO is hoofdcriterium; twee extra signalen als fallback
        const isPro  = seller.user_type === "pro";
        const hub    = seller.can_sell_via_hub === true;
        const sealCT = seller.can_sell_sealed_with_ct_zero === true;
        isZeroLike   = isPro || hub || sealCT;
      } else {
        // zeroMode === "none": geen filtering
        isZeroLike = true;
      }
    }
    if (zeroOnly && !isZeroLike) continue;

    // ----- rest: cond/lang/foil/price -----
    const props = (o.properties_hash ?? o.properties ?? {}) as any;
    const cond  = normCond(props.condition ?? o.condition);
    if (!cond) continue;

    const lang  = normLang(props.mtg_language ?? props.language ?? o.language ?? "en");
    if (lang !== "en") continue;

    const foil  = Boolean(props.mtg_foil ?? props.foil ?? o.foil);
    const price = pickPrice(o);
    if (!price || price <= 0) continue;

    out.push({ price, cond, lang: "en", foil, seller: sellerName });
  }
  return out;
}

