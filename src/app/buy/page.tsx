"use client";

import { useState, useEffect, useMemo } from "react";
import { useDebounce } from "use-debounce";
import Image from "next/image";
import { useCart } from "@/lib/store/cart";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CartModal from "@/components/cart/CartModal";
import { computeUnitFromTrend, type CondKey } from "@/lib/buylistEngineCore";

const GOLD = "#C9A24E";

/** ---- Types (één plek) ---- */
type Condition = "NM" | "EX" | "GD" | "PL" | "PO";

type Item = {
  id: string;
  name: string;
  set: string;
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
};

type CartShape = {
  items: {
    cardmarketId?: number | null;
    qty: number;
  }[];
};



type BuyItem = Item; // alias ter vervanging van dubbele 'Item' definities

function conditionToCondKey(c: Condition): CondKey {
  // 1-op-1 mapping; engine beslist wat we met PL/PO doen (nu: niet kopen)
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



export default function BuyPage() {
  // SEARCH BAR
  const [q, setQ] = useState("");
  const [dq] = useDebounce(q, 350);

  // API DATA
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[]>([]);

  // VIEW / FILTERS / PREVIEW
  const [view, setView] = useState<"grid" | "list">("grid");
  const [rarity, setRarity] = useState("");

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

  // RARITY TAG STYLE
  const rarityClass = (r: string) =>
    r === "mythic"
      ? "bg-[#8B3A3A]"
      : r === "rare"
      ? "bg-[#4A447A]"
      : r === "uncommon"
      ? "bg-[#345A48]"
      : "bg-[#4E4E4E]";

  // quick helpers
  const setPrefCond = (id: string, c: Condition) =>
    setPrefs((s) => ({ ...s, [id]: { ...getPref(id), condition: c } }));
  const togglePrefFoil = (id: string) =>
    setPrefs((s) => ({
      ...s,
      [id]: { ...getPref(id), foil: !getPref(id).foil },
    }));


    
// hoeveel mogen we nog bijkopen voor deze cardmarketId t.o.v. de cap?
function remainingCapForItem(
  it: Item,
  cart: { items: Array<{ cardmarketId?: number | null; qty: number }> }
): number | null {
  const maxBuy = it.maxBuy;
  const cmId = it.cardmarketId ?? null;

  if (maxBuy == null || cmId == null) return null; // geen cap bekend

  // totalen in de cart voor deze cardmarketId (alle condities/foils samen)
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
  if (remaining !== null && remaining <= 0) return; // cap bereikt

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
  });
};



  // Which item is currently previewed in list view
  const [preview, setPreview] = useState<Item | null>(null);

  // ✅ API FETCH — Live Query Search
  useEffect(() => {
    let active = true;

    if (dq.length < 2) {
      setItems([]);
      return;
    }
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(
          `/api/prices/search?query=${encodeURIComponent(dq)}`
        );
        const msg = await res.json();
        if (!active) return;
        setItems((msg.items ?? []) as Item[]);
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [dq]);

  // ✅ FILTERED LIST (visible)
  const visible = useMemo(
    () =>
      items.filter(
        (it) =>
          (!dq || it.name.toLowerCase().includes(dq.toLowerCase())) &&
          (rarity ? it.rarity?.toLowerCase() === rarity : true)
      ),
    [items, dq, rarity]
  );

  // Preview prefs/payout
  const previewPref = preview ? getPref(preview.id) : null;
const previewPayout =
  preview && previewPref ? computeClientPayout(preview, previewPref) : null;
const remaining = preview ? remainingCapForItem(preview, cart) : null;
const atCap = remaining !== null && remaining <= 0;



  return (
    <div
      className="min-h-screen text-slate-200"
      style={{
        background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)",
      }}
    >
      {/* ✅ HEADER */}
      <header className="w-full bg-transparent">
        <div className="mx-auto w-full max-w-[1500px] px-6 lg:px-12 pt-8 pb-4 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight af-text">
              Sell Your Magic: the Gathering Cards
            </h1>
            <p className="mt-1 af-muted">
              Premium payouts • Snelle beoordeling • Transparant
            </p>
          </div>
          <CartModal />
        </div>
      </header>

      {/* ✅ MAIN CONTENT (centered) */}
      <main className="mx-auto w-full max-w-[1200px] px-6 lg:px-12 pb-16">
        {/* SEARCH AND TOOLS */}
        <div className="sticky top-16 z-10 rounded-xl af-panel border p-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] items-center">
            
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Zoek op kaartnaam (min. 2 letters Let op: zoek is gevoelig voor accenten en komma’s)…"
              className="h-12 text-base af-card border px-3 af-text placeholder:af-muted focus-visible:ring-0"
            />
            <select
              value={rarity}
              onChange={(e) => setRarity(e.target.value)}
              className="h-12 rounded-md af-card border px-3 text-sm af-text"
            >
              <option value="">Alle rarities</option>
              <option value="common">Common</option>
              <option value="uncommon">Uncommon</option>
              <option value="rare">Rare</option>
              <option value="mythic">Mythic</option>
            </select>

            <div className="flex gap-2">
              <Button
                variant={view === "grid" ? "default" : "secondary"}
                onClick={() => setView("grid")}
              >
                Grid
              </Button>
              <Button
                variant={view === "list" ? "default" : "secondary"}
                onClick={() => setView("list")}
              >
                List
              </Button>
            </div>
          </div>

          <div className="mt-1 text-right text-xs af-muted">
            {loading
              ? "Zoeken…"
              : visible.length
              ? `${visible.length} resultaten`
              : dq.length >= 2
              ? "Niets gevonden"
              : ""}
          </div>
        </div>

        {/* ✅ GRID VIEW */}
        {view === "grid" && (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
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
                      {it.set?.toUpperCase()}{" "}
                      {it.rarity ? `• ${it.rarity}` : ""}
                    </div>
                  </CardHeader>

                  <CardContent>
                    {/* IMAGE */}
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

                    {/* price + controls + add */}
                    <div className="mt-3 flex items-center gap-3">
                      {/* price */}
                      {payout ? (
                        <div
                          className="tabular-nums text-lg font-semibold"
                          style={{ color: "#C9A24E" }}
                        >
                          € {payout.toFixed(2)}
                        </div>
                      ) : (
                        <div className="text-xs af-muted">—</div>
                      )}

                      {/* cond */}
                      <select
                        value={pref.condition}
                        onChange={(e) =>
                          setPrefCond(it.id, e.target.value as Condition)
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

                      {/* foil */}
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

                      {/* add */}
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
          <div className="mt-8 grid gap-6 grid-cols-[minmax(0,1fr)_380px] items-start">
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
                    {/* tiny thumb */}
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

                    {/* name + meta */}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-medium af-text">
                        {it.name}
                      </div>
                      <div className="text-xs af-muted mt-[2px]">
                        {it.set?.toUpperCase()}{" "}
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

                    {/* price + inline controls + add */}
                    <div className="ml-auto flex items-center gap-2">
                      {/* price */}
                      {payout ? (
                        <div
                          className="tabular-nums text-lg font-semibold mr-1"
                          style={{ color: GOLD }}
                        >
                          € {payout.toFixed(2)}
                        </div>
                      ) : (
                        <div className="text-xs af-muted mr-1">
                          —
                        </div>
                      )}

                      <div className="hidden sm:block text-[10px] af-muted text-right mr-1">
                        {pref.condition}
                        {pref.foil ? " • Foil" : ""}
                      </div>

                      {/* condition select */}
                      <select
                        value={pref.condition}
                        onChange={(e) =>
                          setPrefCond(it.id, e.target.value as Condition)
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

                      {/* foil toggle pill */}
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

                      {/* add with price */}
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
                  Hover een kaart voor preview
                </div>
              ) : (
                <div className="h-full w-full">
                  <div className="text-base font-semibold mb-1 af-text">
                    {preview.name}
                  </div>
                  <div className="text-xs af-muted mb-3">
                    {preview.set?.toUpperCase()}
                  </div>

                  {/* Big image */}
                  <div
                    className="mx-auto rounded border border-[var(--border)] bg-black/30 w-[280px] h-[420px] bg-no-repeat bg-center bg-contain shadow-[0_10px_30px_rgba(0,0,0,.35)]"
                    style={{
                      backgroundImage: `url("${
                        (preview.imageNormal || preview.imageSmall) ?? ""
                      }")`,
                    }}
                  />

                  {/* Price */}
                  {previewPayout ? (
                    <div
                      className="mt-3 text-center text-xl font-bold"
                      style={{ color: "#C9A24E" }}
                    >
                      € {previewPayout.toFixed(2)}
                    </div>
                  ) : (
                    <div className="mt-3 text-center text-xs af-muted">
                      Geen payout
                    </div>
                  )}

                  {/* Controls */}
                  <div className="mt-4 flex items-center justify-center gap-3">
                    {/* Condition */}
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

                    {/* Foil toggle */}
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

        {/* Add button */}
        <div className="mt-4 grid place-items-center">
          <Button
            className="btn-gold font-semibold min-w-[180px]"
            disabled={!previewPayout || atCap}
            onClick={() => handleAdd(preview)}
          >
            {atCap
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
      </main>
    </div>
  );
}
