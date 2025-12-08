"use client";

import { useState } from "react";
import Link from "next/link";
import { useCart } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";
import CartModal from "@/components/cart/CartModal";
import { computeUnitFromTrend, type CondKey } from "@/lib/buylistEngineCore";
import BuyHeader from "@/components/buy/BuyHeader";
import { PageContainer } from "@/components/layout/page-container";


const GOLD = "#C9A24E";

// ==== Types ==== //

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
  // 🔢 nieuw: collector number van de variant
  collectorNumber?: string | null;
};

type ParsedLine = {
  id: number;
  raw: string;
  qty: number;
  name: string;
  setHint?: string | null;
  foilHint?: boolean;
  // 🔢 nieuw: collector number uit de user input
  collectorNumber?: string | null;
};

type ResolvedLine = ParsedLine & {
  item?: Item;
  // alle gevonden varianten voor deze naam/set/collector
  candidates?: Item[];
  selectedIndex?: number;
  payout?: number | null;
  status: "ok" | "no-match" | "error";
  message?: string;
  cond: Condition;
  foil: boolean;
};

// ==== Helpers ==== //

function conditionToCondKey(c: Condition): CondKey {
  return c as CondKey;
}

function computeClientPayout(it: Item, cond: Condition, foil: boolean): number | null {
  if (it.cardmarketId == null) return null;
  if (it.trend == null && it.trendFoil == null) return null;

  const { unit, allowed } = computeUnitFromTrend({
    trend: it.trend,
    trendFoil: it.trendFoil,
    isFoil: foil,
    cond: conditionToCondKey(cond),
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

// simpele parser: "4 Solitude MH2", "4x Solitude mh2 foil", "Solitude" (qty=1),
// en nu ook collector numbers: "Endurance MH2 #123", "Endurance 123#", "Endurance #123", "Endurance MH2 123"
function parseText(text: string): ParsedLine[] {
  const lines = text.split(/\r?\n/);
  const result: ParsedLine[] = [];
  let id = 1;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // match "4x Cardname", "4 Cardname", "4× Cardname"
    const qtyMatch = trimmed.match(/^(\d+)\s*[xX\u00D7]?\s+(.+)$/);
    let qty = 1;
    let rest = trimmed;

    if (qtyMatch) {
      qty = Number(qtyMatch[1]) || 1;
      rest = qtyMatch[2].trim();
    }

    let setHint: string | null = null;
    let foilHint: boolean | undefined = undefined;
    let collectorNumber: string | null = null;

    const tokens = rest.split(/\s+/);

    // 1) foil aan het einde herkennen
    if (tokens.length > 1) {
      const last = tokens[tokens.length - 1].toLowerCase();
      if (last === "foil" || last === "(foil)" || last === "f") {
        foilHint = true;
        tokens.pop();
      }
    }

    // 2) collector number aan het einde herkennen
    //    Voorbeelden:
    //    123      -> digits only
    //    #123     -> leading '#'
    //    123#     -> trailing '#'
    if (tokens.length > 1) {
      const last = tokens[tokens.length - 1];

      // "#123" of "#123a"
      const mLeading = last.match(/^#([0-9A-Za-z]+)$/);
      // "123#" of "123a#"
      const mTrailing = last.match(/^([0-9A-Za-z]+)#$/);

      if (mLeading && /\d/.test(mLeading[1])) {
        collectorNumber = mLeading[1];
        tokens.pop();
      } else if (mTrailing && /\d/.test(mTrailing[1])) {
        collectorNumber = mTrailing[1];
        tokens.pop();
      } else if (/^[0-9]{1,4}$/.test(last)) {
        // pure digits (1–4) → collector number
        collectorNumber = last;
        tokens.pop();
      }
    }

    // 3) setcode aan het einde herkennen, maar alleen als het ALL CAPS is.
    // Voorbeeld: "Solitude MH2" ✓, maar "Ancient Tomb" ✗
    if (tokens.length > 1) {
      const last = tokens[tokens.length - 1];

      // alleen echte setcodes zoals MH2, TMP, LTR, 2XM, etc.
      if (/^[A-Z0-9]{2,5}$/.test(last)) {
        setHint = last; // al uppercase
        tokens.pop(); // haal setcode uit de naam
      }
    }

    const name = tokens.join(" ").trim();

    result.push({
      id: id++,
      raw,
      qty,
      name,
      setHint,
      foilHint,
      collectorNumber,
    });
  }

  return result;
}

// recompute één rij (voor cond/foil/variant wijzigingen)
function recomputeRow(base: ResolvedLine): ResolvedLine {
  if (!base.item) return base;

  const payout = computeClientPayout(base.item, base.cond, base.foil);

  if (!payout) {
    return {
      ...base,
      payout: null,
      status: "error",
      message: "We kopen deze kaart momenteel niet in.",
    };
  }

  return {
    ...base,
    payout,
    status: "ok",
    message: undefined,
  };
}

// ==== Component ==== //

export default function BuyListUploadPage() {
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ParsedLine[]>([]);
  const [rows, setRows] = useState<ResolvedLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalCond, setGlobalCond] = useState<Condition>("NM");
  const [globalFoil, setGlobalFoil] = useState(false);
  const cart = useCart();

  // kleine helper om 1 rij te updaten
  function updateRow(id: number, fn: (r: ResolvedLine) => ResolvedLine) {
    setRows((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
  }

  async function handleParseAndMatch() {
    const parsedLines = parseText(rawText);
    setParsed(parsedLines);
    setRows([]);
    if (!parsedLines.length) return;

    setLoading(true);
    try {
      // unieke combinaties: naam + setHint + collectorNumber
      const keys = Array.from(
        new Set(
          parsedLines.map(
            (l) => `${l.name}||${l.setHint ?? ""}||${l.collectorNumber ?? ""}`
          )
        )
      );

      const keyToCandidates = new Map<string, Item[]>();
      const keyToChosen = new Map<string, Item | undefined>();

      await Promise.all(
        keys.map(async (key) => {
          const [name, setHintRaw, collectorRaw] = key.split("||");
          const setHint = (setHintRaw || "").toUpperCase() || null;
          const collectorNumber = collectorRaw || "";

          try {
            // 🔍 zoek alleen op naam (server kan later set/collector gebruiken)
            const res = await fetch(
              `/api/prices/search?query=${encodeURIComponent(name)}`
            );
            const body = await res.json();
            const items = (body.items ?? []) as Item[];

            keyToCandidates.set(key, items);

            if (!items.length) {
              keyToChosen.set(key, undefined);
              return;
            }

            let chosen: Item | undefined;

            // eerst filter op set (als setHint er is)
            const withSet = setHint
              ? items.filter(
                  (it) => (it.set ?? "").toUpperCase() === setHint
                )
              : items;

            // dan, als collectorNumber bekend is, proberen daarop te matchen
            if (collectorNumber) {
              const collMatches = withSet.filter(
                (it) =>
                  (it.collectorNumber ?? "") === collectorNumber
              );
              if (collMatches.length) {
                chosen = collMatches[0];
              }
            }

            // anders, als er een setHint is, pak eerste met juiste set
            if (!chosen && setHint && withSet.length) {
              chosen = withSet[0];
            }

            // laatste fallback: simpelweg eerste resultaat
            if (!chosen) {
              chosen = items[0];
            }

            keyToChosen.set(key, chosen);
          } catch {
            keyToCandidates.set(key, []);
            keyToChosen.set(key, undefined);
          }
        })
      );

      const resolved: ResolvedLine[] = parsedLines.map((line) => {
        const key = `${line.name}||${line.setHint ?? ""}||${
          line.collectorNumber ?? ""
        }`;
        const candidates = keyToCandidates.get(key) ?? [];
        const item = keyToChosen.get(key);

        // standaard cond/foil voor deze regel
        const lineCond: Condition = globalCond;
        const lineFoil: boolean = line.foilHint ?? globalFoil;

        if (!item) {
          return {
            ...line,
            candidates,
            cond: lineCond,
            foil: lineFoil,
            status: "no-match",
            message: "Geen match gevonden",
          };
        }

        const useFoil = lineFoil;
        const payout = computeClientPayout(item, lineCond, useFoil);
        const selectedIndex = candidates.findIndex((c) => c.id === item.id);

        if (!payout) {
          return {
            ...line,
            item,
            candidates,
            selectedIndex: selectedIndex >= 0 ? selectedIndex : undefined,
            payout: null,
            cond: lineCond,
            foil: useFoil,
            status: "error",
            message: "Geen payout (not buying)",
          };
        }

        return {
          ...line,
          item,
          candidates,
          selectedIndex: selectedIndex >= 0 ? selectedIndex : undefined,
          payout,
          cond: lineCond,
          foil: useFoil,
          status: "ok",
        };
      });

      setRows(resolved);
    } finally {
      setLoading(false);
    }
  }

  function addLineToCart(row: ResolvedLine) {
    if (!row.item || !row.payout) return;
    const it = row.item;

    cart.add({
      id: it.id,
      name: it.name,
      set: it.set,
      imageSmall: it.imageSmall,
      cardmarketId: it.cardmarketId ?? undefined,
      payout: row.payout,
      foil: row.foil,
      condition: row.cond,
      qty: row.qty,
    });
  }

  function addAllToCart() {
    rows
      .filter((r) => r.status === "ok" && r.item && r.payout)
      .forEach(addLineToCart);
  }

  const okCount = rows.filter((r) => r.status === "ok").length;
  const noMatchCount = rows.filter((r) => r.status === "no-match").length;

  return (
    <div
      className="min-h-screen text-slate-200"
      style={{
        background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)",
      }}
    >
      <BuyHeader />
      <main className="mx-auto w-full max-w-[1200px] px-6 lg:px-12 pb-16 pt-10 space-y-8">

        {/* header */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight af-text">
              List upload – Buylist
            </h1>
            <p className="mt-1 text-sm af-muted">
              Plak je decklist of collectie. We herkennen aantallen en kaarten
              automatisch.
            </p>
          </div>
          <div className="flex items-center gap-3">
            
          </div>
        </div>

        {/* paste + settings */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start">
          <div className="af-panel rounded-xl border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium af-text">
                Plak hier je lijst (setcode in hoofdletters)
              </span>
              <span className="text-xs af-muted">
                Formaten:{" "}
                <code className="font-mono">
                  4 Solitude MH2 Foil / 3x Force of Will / Ancient Tomb / Endurance MH2 #123
                </code>
              </span>
            </div>
            <textarea
              className="w-full h-64 rounded-md border border-[var(--border)] bg-white p-3 text-sm font-mono text-black placeholder:text-slate-400 outline-none resize-y"
              placeholder={
                "Voorbeeld:\n4 Quantum Riddler EOE\n2 Lorien Revealed\n1 Endurance MH2 #123\n1 Ugin, Eye of the Storm"
              }
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />

            <div className="mt-3 flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="af-muted text-xs">Conditie</span>
                  <select
                    value={globalCond}
                    onChange={(e) =>
                      setGlobalCond(e.target.value as Condition)
                    }
                    className="h-8 rounded border border-[var(--border)] bg-[var(--bg2)] px-2 text-xs af-text"
                  >
                    <option value="NM">NM</option>
                    <option value="EX">EX</option>
                    <option value="GD">GD</option>
                    <option value="PL">PL</option>
                    <option value="PO">PO</option>
                  </select>
                </div>

                <label className="flex items-center gap-2 text-xs af-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={globalFoil}
                    onChange={(e) => setGlobalFoil(e.target.checked)}
                  />
                  Foil (default)
                </label>
              </div>

              <Button
                onClick={handleParseAndMatch}
                disabled={loading || !rawText.trim()}
                className="btn-gold px-4 py-2 text-sm font-semibold"
              >
                {loading ? "Matchen…" : "Upload & match"}
              </Button>
            </div>
          </div>

          {/* kleine summary */}
          <div className="af-panel rounded-xl border p-4 text-sm">
            <h2 className="font-semibold af-text mb-2">Overzicht</h2>
            <p className="af-muted">
              Verwerkte regels:{" "}
              <span className="af-text font-semibold">{parsed.length}</span>
            </p>
            <p className="af-muted">
              Matches:{" "}
              <span className="text-emerald-300 font-semibold">
                {okCount}
              </span>
            </p>
            <p className="af-muted">
              Geen match:{" "}
              <span className="text-red-300 font-semibold">
                {noMatchCount}
              </span>
            </p>

            <Button
              onClick={addAllToCart}
              disabled={!okCount}
              className="mt-4 w-full btn-gold font-semibold py-2"
            >
              Voeg alle matches toe aan mandje
            </Button>

            <p className="mt-3 text-xs af-muted">
              Alleen regels met een gevonden kaart én geldige payout worden
              toegevoegd.
            </p>
          </div>
        </div>

        {/* result table */}
        {rows.length > 0 && (
          <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg2)] overflow-hidden">
            <div className="px-4 py-2 border-b border-[var(--border)] text-xs af-muted">
              Resultaten
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs af-text">
                <thead className="bg-black/40">
                  <tr className="af-text text-xs">
                    <th className="px-3 py-2 text-left">Qty</th>
                    <th className="px-3 py-2 text-left">Naam (input)</th>
                    <th className="px-3 py-2 text-left">Match / variant</th>
                    <th className="px-3 py-2 text-left">Cond / Foil</th>
                    <th className="px-3 py-2 text-left">Payout / stuk</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Actie</th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-[var(--border)] text-xs"
                    >
                      {/* Qty – editable */}
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          value={row.qty}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            const safe =
                              Number.isFinite(v) && v > 0 ? v : 1;
                            updateRow(row.id, (r) => ({ ...r, qty: safe }));
                          }}
                          className="w-14 rounded border border-[var(--border)] bg-transparent px-1 text-xs af-text"
                        />
                      </td>

                      {/* input name */}
                      <td className="px-3 py-2 font-mono af-text">
                        {row.name}
                        {row.setHint && (
                          <span className="ml-1 text-[10px] af-muted">
                            ({row.setHint})
                          </span>
                        )}
                        {row.collectorNumber && (
                          <span className="ml-1 text-[10px] af-muted">
                            #{row.collectorNumber}
                          </span>
                        )}
                      </td>

                      {/* match + set + variant dropdown */}
                      <td className="px-3 py-2">
                        {row.item ? (
                          <>
                            <div className="af-text">
                              {row.item.name}
                            </div>
                            <div className="af-muted text-[10px]">
                              {row.item.set?.toUpperCase()}
                              {row.item.collectorNumber
                                ? ` #${row.item.collectorNumber}`
                                : ""}
                              {row.foil ? " • Foil" : ""}
                            </div>

                            {row.candidates &&
                              row.candidates.length > 1 && (
                                <select
                                  value={row.item.id}
                                  onChange={(e) => {
                                    const newId = e.target.value;
                                    updateRow(row.id, (prev) => {
                                      if (!prev.candidates) return prev;
                                      const idx =
                                        prev.candidates.findIndex(
                                          (c) => c.id === newId
                                        );
                                      if (idx === -1) return prev;
                                      const newItem =
                                        prev.candidates[idx];
                                      const base: ResolvedLine = {
                                        ...prev,
                                        item: newItem,
                                        selectedIndex: idx,
                                      };
                                      return recomputeRow(base);
                                    });
                                  }}
                                  className="mt-1 h-7 rounded border border-[var(--border)] bg-white px-1 text-[10px] text-black"
                                  >
                                  {row.candidates.map((cand) => (
                                    <option
                                      key={cand.id}
                                      value={cand.id}
                                    >
                                      {cand.name} •{" "}
                                      {cand.set?.toUpperCase()}
                                      {cand.collectorNumber
                                        ? ` #${cand.collectorNumber}`
                                        : ""}
                                    </option>
                                  ))}
                                </select>
                              )}
                          </>
                        ) : (
                          <span className="text-red-300 text-xs">
                            Geen match
                          </span>
                        )}
                      </td>

                      {/* cond / foil dropdowns */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <select
                            value={row.cond}
                            onChange={(e) =>
                              updateRow(row.id, (r) =>
                                recomputeRow({
                                  ...r,
                                  cond: e.target.value as Condition,
                                })
                              )
                            }
                            className="h-7 rounded border border-[var(--border)] bg-white px-1 text-[11px] text-black"
                          >
                            <option value="NM">NM</option>
                            <option value="EX">EX</option>
                            <option value="GD">GD</option>
                            <option value="PL">PL</option>
                            <option value="PO">PO</option>
                          </select>

                          <label className="flex items-center gap-1 text-[11px] af-muted">
                            <input
                              type="checkbox"
                              checked={row.foil}
                              onChange={(e) =>
                                updateRow(row.id, (r) =>
                                  recomputeRow({
                                    ...r,
                                    foil: e.target.checked,
                                  })
                                )
                              }
                            />
                            Foil
                          </label>
                        </div>
                      </td>

                      {/* payout */}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.payout
                          ? `€ ${row.payout.toFixed(2)}`
                          : row.item
                          ? "—"
                          : ""}
                      </td>

                      {/* status */}
                      <td className="px-3 py-2 text-center">
                        {row.status === "ok" && (
                          <span className="text-emerald-300 text-xs">
                            OK
                          </span>
                        )}
                        {row.status === "no-match" && (
                          <span className="text-red-300 text-xs">
                            Geen match
                          </span>
                        )}
                        {row.status === "error" && (
                          <span className="text-amber-300 text-[11px]">
                            {row.message ?? "Error"}
                          </span>
                        )}
                      </td>

                      {/* actie */}
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          disabled={
                            row.status !== "ok" ||
                            !row.item ||
                            !row.payout
                          }
                          onClick={() => addLineToCart(row)}
                          className="btn-gold px-3 py-1 text-xs font-semibold"
                        >
                          Voeg toe
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
