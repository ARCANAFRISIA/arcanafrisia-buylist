"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

type BuyableReason =
  | "OK"
  | "NO_PRICE"
  | "SERIES_NOT_ALLOWED"
  | "LOW_RARITY_UNDER_MIN_PRICE"
  | "PAYOUT_UNDER_MIN";

type PokemonSearchRow = {
  id: string;
  name: string;
  setCode: string;
  setName: string;
  setSeries: string;
  number: string;
  rarity: string;
  rarityBucket: "LOW" | "MID" | "HIGH" | "PREMIUM";
  image: string | null;
  marketPrice: number | null;
  payout: number | null;
  priceSource: "trend" | "avg7" | "avg30" | "avg" | "low" | "blend" | null;
  supertype: string;
  cardmarketUpdatedAt: string | null;
  hasLivePrice: boolean;
  isBuyable: boolean;
  buyableReason: BuyableReason;
  debug?: {
    matchedProductId?: number | null;
    matchedExpansionName?: string | null;
    matchedNumber?: string | null;
    matchedRarity?: string | null;
    matchScore?: number | null;
  };
};

type SearchMeta = {
  availableSeries: string[];
  availableSets: string[];
  availableRarities: string[];
  availableSupertypes: string[];
};

type CartLine = PokemonSearchRow & {
  qty: number;
  total: number;
};

type SortKey =
  | "relevance"
  | "name_asc"
  | "name_desc"
  | "price_desc"
  | "price_asc"
  | "payout_desc"
  | "payout_asc"
  | "set_asc"
  | "number_asc";

function getBuyableLabel(reason: BuyableReason) {
  if (reason === "NO_PRICE") return "Pricing soon";
  if (reason === "LOW_RARITY_UNDER_MIN_PRICE") return "Low rarity < €1.50";
  if (reason === "PAYOUT_UNDER_MIN") return "Below min payout";
  return "Not buyable";
}

export default function PokemonBuylistPage() {
  const [query, setQuery] = useState("");
  const [selectedSetName, setSelectedSetName] = useState("");
  const [selectedRarity, setSelectedRarity] = useState("");
  const [sort, setSort] = useState<SortKey>("relevance");
  const [buyableOnly, setBuyableOnly] = useState(false);

  const [items, setItems] = useState<PokemonSearchRow[]>([]);
  const [meta, setMeta] = useState<SearchMeta>({
    availableSeries: [],
    availableSets: [],
    availableRarities: [],
    availableSupertypes: ["Pokémon", "Trainer", "Energy"],
  });
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<Record<string, CartLine>>({});

  const hasSearchCriteria =
    query.trim().length >= 2 || !!selectedSetName || !!selectedRarity || buyableOnly;

  useEffect(() => {
    let active = true;

    async function loadMeta() {
      try {
        const res = await fetch("/api/pokemon/search", { cache: "no-store" });
        const json = await res.json();
        if (!active) return;

        if (json.meta) {
          setMeta(json.meta as SearchMeta);
        }
      } catch (error) {
        console.error("pokemon meta load failed", error);
      }
    }

    loadMeta();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!hasSearchCriteria) {
      setItems([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setLoading(true);

        const params = new URLSearchParams();

        if (query.trim()) params.set("query", query.trim());
        if (selectedSetName) params.set("setName", selectedSetName);
        if (selectedRarity) params.set("rarity", selectedRarity);
        if (sort) params.set("sort", sort);
        if (buyableOnly) params.set("buyableOnly", "1");

        const res = await fetch(`/api/pokemon/search?${params.toString()}`, {
          cache: "no-store",
        });

        const json = await res.json();
        if (!active) return;

        setItems((json.items ?? []) as PokemonSearchRow[]);

        if (json.meta) {
          setMeta(json.meta as SearchMeta);
        }
      } catch (error) {
        console.error("pokemon search failed", error);
        if (!active) return;
        setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, selectedSetName, selectedRarity, sort, buyableOnly, hasSearchCriteria]);

  const filteredCards = useMemo(() => items, [items]);

  const selectedItems = useMemo<CartLine[]>(() => {
    return Object.values(cart).sort((a, b) => a.name.localeCompare(b.name));
  }, [cart]);

  const totalQty = selectedItems.reduce((sum, item) => sum + item.qty, 0);
  const totalValue = selectedItems.reduce((sum, item) => sum + item.total, 0);

  function canAdd(card: PokemonSearchRow) {
    return card.isBuyable && card.payout != null && card.payout > 0;
  }

  function increment(card: PokemonSearchRow) {
    if (!canAdd(card)) return;

    setCart((prev) => {
      const current = prev[card.id];
      const nextQty = Math.min((current?.qty ?? 0) + 1, 8);

      return {
        ...prev,
        [card.id]: {
          ...card,
          qty: nextQty,
          total: nextQty * (card.payout ?? 0),
        },
      };
    });
  }

  function decrement(cardId: string) {
    setCart((prev) => {
      const current = prev[cardId];
      if (!current) return prev;

      if (current.qty <= 1) {
        const next = { ...prev };
        delete next[cardId];
        return next;
      }

      return {
        ...prev,
        [cardId]: {
          ...current,
          qty: current.qty - 1,
          total: (current.qty - 1) * (current.payout ?? 0),
        },
      };
    });
  }

  function clearCart() {
    setCart({});
  }

  function resetFilters() {
    setQuery("");
    setSelectedSetName("");
    setSelectedRarity("");
    setSort("relevance");
    setBuyableOnly(false);
    setItems([]);
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-[#111827]">
      <header className="sticky top-0 z-40 border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto flex h-16 max-w-[1800px] items-center justify-between px-4 md:px-6">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#111827]">
              Card House Of The East
            </div>
            <div className="text-xs text-[#6b7280]">Pokémon Buylist Concept</div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden rounded-full border border-[#e5e7eb] bg-[#f9fafb] px-3 py-1 text-xs text-[#4b5563] md:inline-flex">
              Modern hits only
            </div>

            <button
              type="button"
              className="rounded-full border border-[#fecaca] bg-[#fef2f2] px-3 py-1 text-xs font-medium text-[#dc2626] lg:hidden"
            >
              Cart ({totalQty})
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-6 md:px-6">
        <div className="grid grid-cols-1 gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_320px] min-[1400px]:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0">
            <div className="mb-6">
              <h1 className="text-3xl font-semibold tracking-tight text-[#111827]">
                Pokémon Buylist
              </h1>

              <p className="mt-2 max-w-4xl text-sm leading-6 text-[#6b7280]">
                Search modern Pokémon cards live, or browse by set. You can also search directly by
                name + number, like <span className="font-medium">houndoom 66</span>.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Pill label="Near Mint only" />
                <Pill label="Sword & Shield" />
                <Pill label="Scarlet & Violet" />
                <Pill label="Mega Evolution" />
                <Pill label="Max 8 per card" />
              </div>
            </div>

            <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="relative">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by card name or name + number..."
                    className="h-12 w-full rounded-xl border border-[#e5e7eb] bg-white px-4 pr-12 text-sm text-[#111827] outline-none placeholder:text-[#9ca3af]"
                  />

                  <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
                    <SearchIcon />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <CompactSelect
                    value={sort}
                    onChange={(v) => setSort(v as SortKey)}
                    minWidthClass="min-w-[180px]"
                    options={[
                      { value: "relevance", label: "Sort by Relevance" },
                      { value: "name_asc", label: "Name A–Z" },
                      { value: "name_desc", label: "Name Z–A" },
                      { value: "price_desc", label: "Market price high → low" },
                      { value: "price_asc", label: "Market price low → high" },
                      { value: "payout_desc", label: "Buy price high → low" },
                      { value: "payout_asc", label: "Buy price low → high" },
                      { value: "set_asc", label: "Set A–Z" },
                      { value: "number_asc", label: "Card number" },
                    ]}
                  />

                  <CompactSelect
                    value={selectedSetName}
                    onChange={setSelectedSetName}
                    minWidthClass="min-w-[120px]"
                    options={[
                      { value: "", label: "Set" },
                      ...meta.availableSets.map((x) => ({ value: x, label: x })),
                    ]}
                  />

                  <CompactSelect
                    value={selectedRarity}
                    onChange={setSelectedRarity}
                    minWidthClass="min-w-[160px]"
                    options={[
                      { value: "", label: "Rarity" },
                      ...meta.availableRarities.map((x) => ({ value: x, label: x })),
                    ]}
                  />

                  <label className="inline-flex h-11 cursor-pointer items-center gap-3 rounded-full border border-[#e5e7eb] bg-white px-4 text-sm text-[#374151]">
                    <input
                      type="checkbox"
                      checked={buyableOnly}
                      onChange={(e) => setBuyableOnly(e.target.checked)}
                      className="h-4 w-4 accent-[#ef4444]"
                    />
                    <span>Buyable only</span>
                  </label>

                  {(query || selectedSetName || selectedRarity || buyableOnly) && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex h-11 items-center rounded-full border border-[#e5e7eb] bg-[#f9fafb] px-4 text-sm text-[#374151] hover:bg-white"
                    >
                      Reset
                    </button>
                  )}

                  <div className="ml-auto text-sm text-[#6b7280]">
                    {loading
                      ? "Searching..."
                      : `${filteredCards.length} result${filteredCards.length === 1 ? "" : "s"}`}
                  </div>
                </div>
              </div>
            </div>

            {!hasSearchCriteria ? (
              <div className="mt-5 rounded-2xl border border-dashed border-[#d1d5db] bg-white p-8 text-center text-sm text-[#6b7280]">
                Start typing a card name, search with name + number, or browse by set.
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3 min-[1400px]:grid-cols-4">
                {filteredCards.map((card) => {
                  const qty = cart[card.id]?.qty ?? 0;
                  const addDisabled = !canAdd(card);

                  return (
                    <div
                      key={card.id}
                      className="rounded-xl border border-[#e5e7eb] bg-white p-3 shadow-sm"
                    >
                      <div className="flex flex-col items-center text-center">
                        <div className="relative mb-3 h-[175px] w-[125px] overflow-hidden rounded-lg">
                          {card.image ? (
                            <Image
                              src={card.image}
                              alt={card.name}
                              fill
                              sizes="125px"
                              className="object-contain"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center rounded-lg bg-[#f3f4f6] text-xs text-[#9ca3af]">
                              No image
                            </div>
                          )}
                        </div>

                        <div className="mb-2 flex min-h-[28px] flex-wrap items-center justify-center gap-1.5">
                          <Badge label={card.setSeries} variant="neutral" />
                          {!card.isBuyable ? (
                            <Badge label={getBuyableLabel(card.buyableReason)} variant="warning" />
                          ) : (
                            <Badge label="Buyable" variant="success" />
                          )}
                        </div>

                        <h3 className="min-h-[2.75rem] line-clamp-2 text-sm font-medium text-[#111827]">
                          {card.name}
                        </h3>

                        <div className="mt-1 text-xs text-[#6b7280]">
                          {card.number} • {card.setName}
                        </div>

                        <div className="mt-3 w-full rounded-md border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-sm text-[#374151]">
                          Near Mint
                        </div>

                        <div className="mt-3 w-full text-left">
                          <div className="text-xs text-[#6b7280]">Market price</div>
                          <div className="text-sm font-medium text-[#111827]">
                            {card.marketPrice != null ? `€ ${card.marketPrice.toFixed(2)}` : "—"}
                          </div>
                          {card.priceSource ? (
                            <div className="mt-1 text-[11px] text-[#9ca3af]">
                              Source: {card.priceSource}
                            </div>
                          ) : (
                            <div className="mt-1 text-[11px] text-[#9ca3af]">
                              No Cardmarket price yet
                            </div>
                          )}
                        </div>

                        <div className="mt-2 w-full text-left">
                          <div className="text-xs text-[#6b7280]">Buy price</div>
                          <div
                            className={
                              card.payout != null && card.isBuyable
                                ? "text-lg font-semibold text-[#dc2626]"
                                : "text-base font-semibold text-[#9ca3af]"
                            }
                          >
                            {card.payout != null && card.isBuyable
                              ? `€ ${card.payout.toFixed(2)}`
                              : "Coming soon"}
                          </div>
                        </div>

                        <div className="mt-2 w-full text-left">
                          <div className="text-xs text-[#6b7280]">Rarity</div>
                          <div className="text-sm text-[#111827]">{card.rarity || "—"}</div>
                        </div>

                        <div className="mt-2 w-full text-left">
                          <div className="text-xs text-[#6b7280]">CM match</div>
                          <div className="text-sm text-[#111827]">
                            {card.debug?.matchedExpansionName || "—"}
                            {card.debug?.matchedProductId ? ` • ${card.debug.matchedProductId}` : ""}
                          </div>
                          <div className="text-[11px] text-[#9ca3af]">
                            #{card.debug?.matchedNumber || "—"} • {card.debug?.matchedRarity || "—"}
                          </div>
                        </div>

                        <div className="mt-2 w-full text-left">
                          <div className="text-xs text-[#6b7280]">Price updated</div>
                          <div className="text-sm text-[#111827]">
                            {card.cardmarketUpdatedAt || "—"}
                          </div>
                        </div>

                        <div className="mt-3 flex w-full items-center gap-2">
                          <button
                            type="button"
                            onClick={() => decrement(card.id)}
                            disabled={qty === 0}
                            className={
                              qty === 0
                                ? "h-9 w-9 rounded-md border border-[#e5e7eb] bg-[#f9fafb] text-lg text-[#9ca3af] cursor-not-allowed"
                                : "h-9 w-9 rounded-md border border-[#d1d5db] bg-white text-lg text-[#374151]"
                            }
                          >
                            −
                          </button>

                          <div className="flex h-9 flex-1 items-center justify-center rounded-md border border-[#d1d5db] bg-white text-sm font-medium text-[#111827]">
                            {qty}
                          </div>

                          <button
                            type="button"
                            onClick={() => increment(card)}
                            disabled={addDisabled || qty >= 8}
                            className={
                              addDisabled || qty >= 8
                                ? "h-9 w-9 rounded-md border border-[#e5e7eb] bg-[#f9fafb] text-lg text-[#9ca3af] cursor-not-allowed"
                                : "h-9 w-9 rounded-md border border-[#d1d5db] bg-white text-lg text-[#374151]"
                            }
                          >
                            +
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => increment(card)}
                          disabled={addDisabled || qty >= 8}
                          className={
                            addDisabled || qty >= 8
                              ? "mt-3 h-10 w-full rounded-md bg-[#e5e7eb] text-sm font-medium text-[#9ca3af] cursor-not-allowed"
                              : "mt-3 h-10 w-full rounded-md bg-[#ef4444] text-sm font-medium text-white hover:bg-[#dc2626]"
                          }
                        >
                          {addDisabled ? getBuyableLabel(card.buyableReason) : "Add to Cart"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="hidden min-[1100px]:block">
            <div className="sticky top-28 overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-sm">
              <div className="border-b border-[#e5e7eb] px-5 py-5">
                <div className="text-2xl font-semibold text-[#111827]">Cart</div>
                <div className="mt-1 text-sm text-[#6b7280]">Concept summary</div>
              </div>

              <div className="max-h-[calc(100vh-260px)] overflow-y-auto px-5 py-5">
                {selectedItems.length === 0 ? (
                  <div className="flex h-[280px] items-center justify-center rounded-xl border border-[#e5e7eb] bg-[#f9fafb] text-sm text-[#6b7280]">
                    No cards added yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedItems.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-[#111827]">
                              {item.name}
                            </div>
                            <div className="mt-1 text-xs text-[#6b7280]">
                              {item.qty} × € {(item.payout ?? 0).toFixed(2)}
                            </div>
                            <div className="mt-1 text-[11px] text-[#9ca3af]">
                              {item.number} • {item.setName}
                            </div>
                          </div>

                          <div className="text-sm font-semibold text-[#111827]">
                            € {item.total.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-[#e5e7eb] px-5 py-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-[#111827]">Total ({totalQty})</span>
                  <span className="font-semibold text-[#111827]">
                    € {totalValue.toFixed(2)}
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  <button
                    type="button"
                    onClick={clearCart}
                    disabled={selectedItems.length === 0}
                    className={
                      selectedItems.length === 0
                        ? "h-11 w-full rounded-md border border-[#d1d5db] bg-white text-sm font-medium text-[#374151] opacity-60 cursor-not-allowed"
                        : "h-11 w-full rounded-md border border-[#d1d5db] bg-white text-sm font-medium text-[#374151] hover:bg-[#f9fafb]"
                    }
                  >
                    Clear Cart
                  </button>

                  <button
                    disabled
                    className="h-11 w-full rounded-md bg-[#ef4444] text-sm font-medium text-white opacity-60"
                  >
                    Proceed to Checkout
                  </button>
                </div>

                <p className="mt-4 text-xs leading-5 text-[#6b7280]">
                  Low rarity cards under €1.50 and cards without live pricing stay visible in
                  search, but cannot be added yet.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-sm text-[#374151] shadow-sm">
      {label}
    </span>
  );
}

function Badge({
  label,
  variant = "neutral",
}: {
  label: string;
  variant?: "neutral" | "warning" | "accent" | "success";
}) {
  const cls =
    variant === "warning"
      ? "border-[#fde68a] bg-[#fffbeb] text-[#b45309]"
      : variant === "accent"
        ? "border-[#fecaca] bg-[#fef2f2] text-[#dc2626]"
        : variant === "success"
          ? "border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]"
          : "border-[#e5e7eb] bg-[#f9fafb] text-[#4b5563]";

  return (
    <span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

function CompactSelect({
  value,
  onChange,
  options,
  minWidthClass = "min-w-[140px]",
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  minWidthClass?: string;
}) {
  return (
    <div className={`relative ${minWidthClass}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full appearance-none rounded-full border border-[#e5e7eb] bg-white px-4 pr-9 text-sm text-[#374151] outline-none hover:bg-[#f9fafb]"
      >
        {options.map((option) => (
          <option key={`${option.label}-${option.value || "all"}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs text-[#6b7280]">
        ▾
      </span>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4 text-[#9ca3af]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.5 13.5 17 17" strokeLinecap="round" />
    </svg>
  );
}