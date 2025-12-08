"use client";

import { useState, useEffect, useMemo } from "react";
import { useDebounce } from "use-debounce";
import Image from "next/image";
import { useCart } from "@/lib/store/cart";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CartModal from "@/components/cart/CartModal"; // blijft staan voor later gebruik
import { computeUnitFromTrend, type CondKey } from "@/lib/buylistEngineCore";
import BuyHeader from "@/components/buy/BuyHeader";
import { PageContainer } from "@/components/layout/page-container";

const GOLD = "#C9A24E";

/** ---- Types ---- */
type Condition = "NM" | "EX" | "GD" | "PL" | "PO";

type Item = {
  id: string;
  name: string;
  set: string;
  collectorNumber?: string | null;
  imageSmall?: string | null;
  imageNormal?: string | null;
  cardmarketId?: number | null;
  trend: number | null;
  trendFoil: number | null;
  rarity?: string | null;
  ownQty?: number | null;
  maxBuy?: number | null;
  tix?: number | null;
  edhrecRank?: number | null;
  gameChanger?: boolean | null;
  ownQtyOnHand?: number | null;
  qtyPending?: number | null;
  legalities?: Record<string, string> | null;
};

type CartShape = {
  items: {
    cardmarketId?: number | null;
    qty: number;
  }[];
};

type BuyItem = Item;

type SetOption = {
  code: string;
  name: string;
};

function conditionToCondKey(c: Condition): CondKey {
  return c as CondKey;
}

function computeClientPayout(
  it: Item,
  pref: { condition: Condition; foil: boolean }
): number | null {
  if (it.cardmarketId == null) return null;
  if (it.trend == null && it.trendFoil == null) return null;

  const condKey = conditionToCondKey(pref.condition);

  const { unit, allowed } = computeUnitFromTrend({
    trend: it.trend,
    trendFoil: it.trendFoil,
    isFoil: pref.foil,
    cond: condKey,
    ctx: {
      ownQty: it.ownQty ?? 0,
      edhrecRank: it.edhrecRank ?? null,
      mtgoTix: it.tix ?? null,
      gameChanger: it.gameChanger ?? null,
    },
  });

  if (!allowed || unit <= 0) return null;
  return unit;
}

// simpele popularity-score voor sort "Most popular"
function popularityScore(it: Item): number {
  const tix = it.tix ?? 0;
  const edh = it.edhrecRank ?? 0;
  const gc = it.gameChanger ? 1 : 0;
  const edhScore = edh ? 100000 - Math.min(edh, 100000) : 0;
  return tix * 100 + edhScore + gc * 50000;
}

// mapping van UI-format naar Scryfall-legalities key
const FORMAT_TO_LEGALITY_KEY: Record<string, string> = {
  Standard: "standard",
  Pioneer: "pioneer",
  Modern: "modern",
  Legacy: "legacy",
  Vintage: "vintage",
  Premodern: "premodern",
  Pauper: "pauper",
  Commander: "commander",
};

type SortKey = "popular" | "nameAsc" | "nameDesc" | "priceAsc" | "priceDesc";

export default function BuyPage() {
  // SEARCH BAR
  const [q, setQ] = useState("");
  const [dq] = useDebounce(q, 350);

  // API DATA
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[]>([]);

  // sets dropdown
  const [setOptions, setSetOptions] = useState<SetOption[]>([]);

  // VIEW
  const [view, setView] = useState<"grid" | "list">("grid");

  // FILTERS
  const [selectedRarity, setSelectedRarity] = useState("");
  const [selectedSet, setSelectedSet] = useState("");
  const [selectedFormat, setSelectedFormat] = useState<FormatOption>("Standard");

  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  // mobiel filters inklappen
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);

  // SORT
  const [sort, setSort] = useState<SortKey>("popular");

  // CART + QTY CONTROL
  const cart = useCart();
  const [qty, setQty] = useState<Record<string, number>>({});
  const qOf = (id: string) => Math.max(1, qty[id] ?? 1);
  const setQTY = (id: string, n: number) =>
    setQty((s) => ({ ...s, [id]: Math.max(1, n) }));

  // PERSONAL PREFS PER ITEM
  const [prefs, setPrefs] = useState<
    Record<string, { condition: Condition; foil: boolean }>
  >({});
  const getPref = (id: string) => prefs[id] ?? { condition: "NM", foil: false };

  const rarityClass = (r: string) =>
    r === "mythic"
      ? "bg-[#8B3A3A]"
      : r === "rare"
      ? "bg-[#4A447A]"
      : r === "uncommon"
      ? "bg-[#345A48]"
      : "bg-[#4E4E4E]";

  const setPrefCond = (id: string, c: Condition) =>
    setPrefs((s) => ({ ...s, [id]: { ...getPref(id), condition: c } }));
  const togglePrefFoil = (id: string) =>
    setPrefs((s) => ({
      ...s,
      [id]: { ...getPref(id), foil: !getPref(id).foil },
    }));

  // cap per card
  function remainingCapForItem(it: Item, cart: CartShape): number | null {
    const maxBuy = it.maxBuy;
    const cmId = it.cardmarketId ?? null;
    if (maxBuy == null || cmId == null) return null;

    const inCart = cart.items
      .filter((c) => c.cardmarketId === cmId)
      .reduce((sum, c) => sum + c.qty, 0);

    const remaining = maxBuy - inCart;
    return remaining <= 0 ? 0 : remaining;
  }

  const handleAdd = (it: BuyItem) => {
    const pref = getPref(it.id);
    const payout = computeClientPayout(it, pref);
    if (!payout) return;

    const remaining = remainingCapForItem(it, cart);
    if (remaining !== null && remaining <= 0) return;

    cart.add({
      id: it.id,
      name: it.name,
      set: it.set,
      imageSmall: it.imageSmall,
      cardmarketId: it.cardmarketId ?? undefined,
      payout,
      foil: pref.foil,
      condition: pref.condition,
      qty: 1,
      collectorNumber: it.collectorNumber ?? undefined,
    });
  };

  // list-view preview
  const [preview, setPreview] = useState<Item | null>(null);
  const previewPref = preview ? getPref(preview.id) : null;
  const previewPayout =
    preview && previewPref ? computeClientPayout(preview, previewPref) : null;
  const previewRemaining = preview ? remainingCapForItem(preview, cart) : null;
  const previewAtCap = previewRemaining !== null && previewRemaining <= 0;

  // ✅ API FETCH — Live Query Search (query + filters naar backend)
  useEffect(() => {
  let active = true;
  setLoading(true);

  (async () => {
    const params = new URLSearchParams();
    const searchingByName = dq.length >= 2;

    if (searchingByName) {
      // Naam-zoek → volledige pool, alleen set-filter als expliciet gekozen
      params.set("query", dq);
      if (selectedSet) {
        params.set("set", selectedSet.toLowerCase());
      }
    } else {
      // Geen naam-zoek → pure filter/browse modus
      const formatKey =
        selectedFormat && FORMAT_TO_LEGALITY_KEY[selectedFormat]
          ? FORMAT_TO_LEGALITY_KEY[selectedFormat]
          : "";

      if (formatKey) {
        params.set("format", formatKey);
      }

      if (selectedSet) {
        params.set("set", selectedSet.toLowerCase());
      }

      if (selectedRarity) {
        params.set("rarity", selectedRarity.toLowerCase());
      }
      // priceMin / priceMax blijven alleen client-side in useMemo
    }

    const res = await fetch(`/api/prices/search?${params.toString()}`);
    const msg = await res.json();
    if (!active) return;
    setItems((msg.items ?? []) as Item[]);
  })().catch((e) => {
    console.error("prices/search failed", e);
  }).finally(() => {
    if (active) setLoading(false);
  });

  return () => {
    active = false;
  };
}, [dq, selectedFormat, selectedSet, selectedRarity]);


  // ✅ sets-lijst éénmalig ophalen
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/prices/sets");
        if (!res.ok) return;
        const data = await res.json();
        setSetOptions(data.sets ?? []);
      } catch (e) {
        console.error("Failed to load set options", e);
      }
    })();
  }, []);

  // ✅ FILTER + SORT (client-side naam + prijsrange + sort)
const visible = useMemo(() => {
  let out = items.slice();
  const searchingByName = dq.length >= 2;

  // naam-filter
  if (dq) {
    const needle = dq.toLowerCase();
    out = out.filter((it) => it.name.toLowerCase().includes(needle));
  }

  // set-filter mag altijd, ook bij name-zoek (voor specifieke print)
  if (selectedSet) {
    const s = selectedSet.toLowerCase().trim();
    out = out.filter((it) => (it.set ?? "").toLowerCase() === s);
  }

  // onderstaande filters alleen als je NIET via naam zoekt
  if (!searchingByName) {
    if (selectedRarity) {
      const r = selectedRarity.toLowerCase();
      out = out.filter((it) => (it.rarity ?? "").toLowerCase() === r);
    }

    if (selectedFormat) {
      const key = FORMAT_TO_LEGALITY_KEY[selectedFormat] ?? null;
      if (key) {
        out = out.filter((it) => {
          const leg = it.legalities;
          if (!leg) return false;
          const setLeg = (leg as any).set ?? {};
          return setLeg[key] === "legal";
        });
      }
    }

    // price range alleen in browse-modus
    const min =
      priceMin.trim() !== ""
        ? Number(priceMin.replace(",", "."))
        : Number.NaN;
    const max =
      priceMax.trim() !== ""
        ? Number(priceMax.replace(",", "."))
        : Number.NaN;

    if (!Number.isNaN(min)) {
      out = out.filter((it) => (it.trend ?? 0) >= min);
    }
    if (!Number.isNaN(max)) {
      out = out.filter((it) => {
        const t = it.trend;
        if (t == null) return false;
        return t <= max;
      });
    }
  }

    // sort
    out.sort((a, b) => {
      switch (sort) {
        case "nameAsc":
          return a.name.localeCompare(b.name);
        case "nameDesc":
          return b.name.localeCompare(a.name);
        case "priceAsc": {
          const pa = a.trend ?? Number.POSITIVE_INFINITY;
          const pb = b.trend ?? Number.POSITIVE_INFINITY;
          return pa - pb;
        }
        case "priceDesc": {
          const pa = a.trend ?? -1;
          const pb = b.trend ?? -1;
          return pb - pa;
        }
        case "popular":
        default: {
          const sa = popularityScore(a);
          const sb = popularityScore(b);
          return sb - sa;
        }
      }
    });

    return out;
  }, [items, dq, selectedFormat, priceMin, priceMax, sort]);


  const totalResults = visible.length;

  // ---------- JSX ----------
  return (
    <div
      className="min-h-screen text-slate-200"
      style={{
        background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)",
      }}
    >
      <BuyHeader />

      <main className="pb-16 pt-6">
        <PageContainer>
          {/* Hero / intro */}
          <section className="mb-4">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight af-text">
              Verkoop je Magic: the Gathering kaarten
            </h1>
            <p className="mt-2 text-sm md:text-base af-muted max-w-2xl">
              Welkom bij de ArcanaFrisia Buylist – de snelste en meest
              betrouwbare manier om oude en nieuwe (1993-2025) Magic kaarten online te verkopen. Wij
              baseren onze buylist-prijzen op Cardmarket trend en betalen tot wel {" "}
              <span className="font-semibold text-slate-100">90%</span> van die waarde, met
              eerlijke grading en snelle uitbetaling.
            </p>
          </section>

          {/* SEARCH + VIEW + SORT */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Zoek op kaartnaam (optioneel)…"
              className="h-16 text-base af-card border px-4 af-text placeholder:af-muted focus-visible:ring-0"
            />

            <div className="flex items-center justify-end gap-3">
              {/* Sort dropdown */}
              <div className="flex items-center gap-2 text-xs md:text-sm">
                <span className="af-muted">Sorteren op</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="h-9 rounded-full border border-[var(--border)] bg-[var(--af-bg2)] px-3 text-xs md:text-sm af-text"
                >
                  <option value="popular">Most popular</option>
                  <option value="nameAsc">Name (A–Z)</option>
                  <option value="nameDesc">Name (Z–A)</option>
                  <option value="priceAsc">Price Low → High</option>
                  <option value="priceDesc">Price High → Low</option>
                </select>
              </div>

              {/* View toggle */}
              <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--af-bg2)] p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setView("list")}
                  className={`flex items-center gap-1 rounded-full px-3 py-1 ${
                    view === "list"
                      ? "bg-white text-black"
                      : "text-slate-200 hover:bg-white/5"
                  }`}
                >
                  <span>☰</span>
                  <span>List</span>
                </button>
                <button
                  type="button"
                  onClick={() => setView("grid")}
                  className={`ml-1 flex items-center gap-1 rounded-full px-3 py-1 ${
                    view === "grid"
                      ? "bg-white text-black"
                      : "text-slate-200 hover:bg-white/5"
                  }`}
                >
                  <span>▦</span>
                  <span>Grid</span>
                </button>
              </div>
            </div>
          </div>


<div className="mt-3 flex items-center justify-between md:hidden">
  <button
    type="button"
    onClick={() => setShowFiltersMobile((v) => !v)}
    className="h-8 text-[13px] inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--af-bg2)] px-3 py-1 hover:bg-white/5"
    style={{ color: "#f9fafb" }}   // <-- forceer tekstkleur
  >
    {showFiltersMobile ? "Filters verbergen" : "Filters tonen"}
  </button>

  <span className="text-[11px] af-muted">
    {totalResults ? `${totalResults} resultaten` : "Geen kaarten gevonden"}
  </span>
</div>




          {/* status / count (desktop) */}
          <div className="mt-1 text-right text-xs af-muted hidden md:block">
            {loading
              ? "Zoeken…"
              : totalResults
              ? `${totalResults} resultaten`
              : "Geen kaarten gevonden"}
          </div>

          {/* hoofdgrid: filters links, resultaten rechts */}
          <div className="mt-6 grid gap-6 md:grid-cols-[260px_minmax(0,1fr)] items-start">
            {/* FILTERS LEFT */}
            <aside
              className={[
                "rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-4 text-xs md:text-sm space-y-4",
                "md:block",
                showFiltersMobile ? "block" : "hidden md:block",
              ].join(" ")}
            >
              <div>
                <div className="font-semibold af-text text-sm mb-1">
                  Filters
                </div>
                <p className="af-muted text-[14px] leading-snug">
                  Combineer set, formaat, rarity en prijs om snel de juiste
                  kaartversie te vinden.
                </p>
              </div>

              {/* Set */}
              <div className="space-y-1">
                <label className="block text-[13px] uppercase tracking-wide af-muted">
                  Set / Edition
                </label>
                <select
                  value={selectedSet}
                  onChange={(e) => setSelectedSet(e.target.value)}
                  className="h-8 w-full rounded border border-[var(--border)] bg-[var(--bg2)] px-2 text-xs af-text"
                >
                  <option value="">Alle sets</option>
                  {setOptions.map((s) => (
                    <option key={s.code} value={s.code.toLowerCase()}>
                      {s.code.toUpperCase()} – {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Format */}
              <div className="space-y-1">
                <label className="block text-[13px] uppercase tracking-wide af-muted">
                  Format
                </label>
                <select
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                  className="h-8 w-full rounded border border-[var(--border)] bg-[var(--bg2)] px-2 text-xs af-text"
                >
                  <option value="Standard">Standard</option>
                  <option value="Pioneer">Pioneer</option>
                  <option value="Modern">Modern</option>
                  <option value="Legacy">Legacy</option>
                  <option value="Vintage">Vintage</option>
                  <option value="Premodern">Premodern</option>
                  <option value="Pauper">Pauper</option>
                  <option value="Commander">Commander</option>
                  <option value="">Alle formats</option>
                </select>
              </div>

              {/* Rarity */}
              <div className="space-y-1">
                <label className="block text-[13px] uppercase tracking-wide af-muted">
                  Rarity
                </label>
                <select
                  value={selectedRarity}
                  onChange={(e) => setSelectedRarity(e.target.value)}
                  className="h-8 w-full rounded border border-[var(--border)] bg-[var(--bg2)] px-2 text-xs af-text"
                >
                  <option value="">Alle rarities</option>
                  <option value="common">Common</option>
                  <option value="uncommon">Uncommon</option>
                  <option value="rare">Rare</option>
                  <option value="mythic">Mythic</option>
                </select>
              </div>

              {/* Price range */}
              <div className="space-y-1">
                <label className="block text-[13px] uppercase tracking-wide af-muted">
                  Price range (CM trend)
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={priceMin}
                    onChange={(e) => setPriceMin(e.target.value)}
                    placeholder="Min €"
                    className="h-8 text-xs af-card"
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={priceMax}
                    onChange={(e) => setPriceMax(e.target.value)}
                    placeholder="Max €"
                    className="h-8 text-xs af-card"
                  />
                </div>
              </div>

            <div className="pt-1 flex justify-between gap-2">
  <button
    type="button"
    onClick={() => {
      setSelectedSet("");
      setSelectedFormat("Standard");
      setSelectedRarity("");
      setPriceMin("");
      setPriceMax("");
    }}
    className="h-8 text-[13px] inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--af-bg2)] px-3 py-1 hover:bg-white/5"
    style={{ color: "#f9fafb" }}   // idem
  >
    Reset filters
  </button>
</div>


            </aside>

            {/* RESULTS RIGHT */}
            <section>
              {/* GRID VIEW */}
              {view === "grid" && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {visible.map((it) => {
                    const pref = getPref(it.id);
                    const payout = computeClientPayout(it, pref);
                    const remaining = remainingCapForItem(it, cart);
                    const atCap = remaining !== null && remaining <= 0;

                    return (
                      <Card key={it.id} className="group af-card border">
                        <CardHeader>
                          <CardTitle className="af-text text-sm leading-tight line-clamp-2">
                            {it.name}
                          </CardTitle>
                          <div className="af-muted text-xs">
                            {it.set?.toUpperCase()}
                            {it.collectorNumber
                              ? ` #${it.collectorNumber}`
                              : ""}
                            {it.rarity ? ` • ${it.rarity}` : ""}
                          </div>
                        </CardHeader>

                        <CardContent>
                          <div className="relative w-full overflow-hidden rounded-lg border af-panel h-[200px] sm:h-[220px]">
                            {it.imageNormal || it.imageSmall ? (
                              <Image
                                src={it.imageNormal || it.imageSmall!}
                                alt={it.name}
                                fill
                                sizes="(min-width:1024px) 25vw, (min-width:640px) 33vw, 50vw"
                                className="object-contain transition-transform duration-300 group-hover:scale-[1.05]"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center af-muted text-xs">
                                No image
                              </div>
                            )}
                          </div>

                          <div className="mt-3 flex items-center gap-3">
                            {payout ? (
                              <div
                                className="tabular-nums text-lg font-semibold"
                                style={{ color: GOLD }}
                              >
                                € {payout.toFixed(2)}
                              </div>
                            ) : (
                              <div className="text-xs af-muted">—</div>
                            )}

                            <select
                              value={pref.condition}
                              onChange={(e) =>
                                setPrefCond(
                                  it.id,
                                  e.target.value as Condition
                                )
                              }
                              className="h-8 rounded border border-[var(--border)] bg-[var(--bg2)] px-2 text-xs af-text"
                              title="Conditie"
                            >
                              <option value="NM">NM</option>
                              <option value="EX">EX</option>
                              <option value="GD">GD</option>
                              <option value="PL">PL</option>
                              <option value="PO">PO</option>
                            </select>

                            <button
                              type="button"
                              onClick={() => togglePrefFoil(it.id)}
                              className={[
                                "h-8 rounded-full px-3 text-xs font-medium border",
                                pref.foil
                                  ? "border-[#2F415B] bg-[#2A3A52] text-white"
                                  : "border-[var(--border)] bg-[var(--bg2)] af-text",
                              ].join(" ")}
                            >
                              {pref.foil ? "Foil ✓" : "Foil"}
                            </button>

                            <Button
                              size="sm"
                              disabled={!payout || atCap}
                              onClick={() => handleAdd(it)}
                              className="btn-gold font-semibold px-3 py-1.5"
                            >
                              {atCap
                                ? "Max bereikt"
                                : payout
                                ? `Add € ${payout.toFixed(2)}`
                                : "Add"}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* LIST VIEW */}
              {view === "list" && (
                <div className="mt-2 grid gap-6 grid-cols-[minmax(0,1fr)_380px] items-start">
                  {/* LEFT: list */}
                  <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--bg2)]">
                    {visible.map((it) => {
                      const isActive = preview?.id === it.id;
                      const pref = getPref(it.id);
                      const payout = computeClientPayout(it, pref);
                      const remaining = remainingCapForItem(it, cart);
                      const atCap = remaining !== null && remaining <= 0;

                      return (
                        <div
                          key={it.id}
                          className="group flex items-center gap-4 px-4 py-3 hover:bg-[#102033] cursor-pointer"
                          onMouseEnter={() => {
                            setPreview(it);
                          }}
                          tabIndex={0}
                        >
                          <div
                            className={[
                              "grid h-12 w-9 flex-none place-items-center overflow-hidden rounded border",
                              isActive
                                ? "border-[#3A5172] ring-2 ring-[#3A5172]"
                                : "border-[var(--border)]",
                              "bg-black/30",
                            ].join(" ")}
                            aria-hidden="true"
                          >
                            {it.imageSmall || it.imageNormal ? (
                              <Image
                                src={it.imageSmall || it.imageNormal!}
                                alt={it.name}
                                width={36}
                                height={48}
                                className="object-contain"
                              />
                            ) : null}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base font-medium af-text">
                              {it.name}
                            </div>
                            <div className="text-xs af-muted mt-[2px]">
                              {it.set?.toUpperCase()}
                              {it.collectorNumber
                                ? ` #${it.collectorNumber}`
                                : ""}
                              {it.rarity && (
                                <span
                                  className={`ml-1 px-2 py-[1px] text-[10px] rounded ${rarityClass(
                                    it.rarity
                                  )}`}
                                >
                                  {it.rarity}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="ml-auto flex items-center gap-2">
                            {payout ? (
                              <div
                                className="tabular-nums text-lg font-semibold mr-1"
                                style={{ color: GOLD }}
                              >
                                € {payout.toFixed(2)}
                              </div>
                            ) : (
                              <div className="text-xs af-muted mr-1">—</div>
                            )}

                            <div className="hidden sm:block text-[10px] af-muted text-right mr-1">
                              {pref.condition}
                              {pref.foil ? " • Foil" : ""}
                            </div>

                            <select
                              value={pref.condition}
                              onChange={(e) =>
                                setPrefCond(
                                  it.id,
                                  e.target.value as Condition
                                )
                              }
                              className="h-7 rounded border border-[var(--border)] bg-[var(--bg2)] px-2 text-xs af-text"
                              title="Conditie"
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <option value="NM">NM</option>
                              <option value="EX">EX</option>
                              <option value="GD">GD</option>
                              <option value="PL">PL</option>
                              <option value="PO">PO</option>
                            </select>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePrefFoil(it.id);
                              }}
                              className={[
                                "h-7 rounded-full px-3 text-xs font-medium border",
                                pref.foil
                                  ? "border-[#2F415B] bg-[#2A3A52] text-white"
                                  : "border-[var(--border)] bg-[var(--bg2)] af-text",
                              ].join(" ")}
                              title="Foil togglen"
                            >
                              {pref.foil ? "Foil ✓" : "Foil"}
                            </button>

                            <Button
                              size="sm"
                              disabled={!payout || atCap}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdd(it);
                              }}
                              className="btn-gold font-semibold px-3 py-1.5"
                            >
                              {atCap
                                ? "Max bereikt"
                                : payout
                                ? `Add € ${payout.toFixed(2)}`
                                : "Add"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* RIGHT: sticky preview */}
                  <aside className="block md:sticky md:top-24 rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-4 h-[560px]">
                    {!preview || !previewPref ? (
                      <div className="h-full grid place-items-center af-muted text-sm">
                        Hover een kaart in de lijst voor een grote preview
                      </div>
                    ) : (
                      <div className="h-full w-full">
                        <div className="text-base font-semibold mb-1 af-text">
                          {preview.name}
                        </div>
                        <div className="text-xs af-muted mb-3">
                          {preview.set?.toUpperCase()}
                          {preview.collectorNumber
                            ? ` #${preview.collectorNumber}`
                            : ""}
                        </div>

                        <div
                          className="mx-auto rounded border border-[var(--border)] bg-black/30 w-[280px] h-[420px] bg-no-repeat bg-center bg-contain shadow-[0_10px_30px_rgba(0,0,0,.35)]"
                          style={{
                            backgroundImage: `url("${
                              (preview.imageNormal || preview.imageSmall) ?? ""
                            }")`,
                          }}
                        />

                        {previewPayout ? (
                          <div
                            className="mt-3 text-center text-xl font-bold"
                            style={{ color: GOLD }}
                          >
                            € {previewPayout.toFixed(2)}
                          </div>
                        ) : (
                          <div className="mt-3 text-center text-xs af-muted">
                            Geen payout
                          </div>
                        )}

                        <div className="mt-4 flex items-center justify-center gap-3">
                          <select
                            value={previewPref.condition}
                            onChange={(e) =>
                              setPrefCond(
                                preview.id,
                                e.target.value as Condition
                              )
                            }
                            className="h-9 rounded border border-[var(--border)] bg-[var(--bg2)] px-2 text-sm af-text"
                            title="Conditie"
                          >
                            <option value="NM">NM</option>
                            <option value="EX">EX</option>
                            <option value="GD">GD</option>
                            <option value="PL">PL</option>
                            <option value="PO">PO</option>
                          </select>

                          <button
                            type="button"
                            onClick={() => togglePrefFoil(preview.id)}
                            className={[
                              "h-9 rounded-full px-3 text-sm font-medium border",
                              previewPref.foil
                                ? "border-[#2F415B] bg-[#2A3A52] text-white"
                                : "border-[var(--border)] bg-[var(--bg2)] af-text",
                            ].join(" ")}
                            title="Foil togglen"
                          >
                            {previewPref.foil ? "Foil ✓" : "Foil"}
                          </button>
                        </div>

                        <div className="mt-4 grid place-items-center">
                          <Button
                            className="btn-gold font-semibold min-w-[180px]"
                            disabled={!previewPayout || previewAtCap}
                            onClick={() => handleAdd(preview)}
                          >
                            {previewAtCap
                              ? "Max bereikt"
                              : previewPayout
                              ? `Add € ${previewPayout.toFixed(2)}`
                              : "Add"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </aside>
                </div>
              )}
            </section>
          </div>
        </PageContainer>
      </main>
    </div>
  );
}
