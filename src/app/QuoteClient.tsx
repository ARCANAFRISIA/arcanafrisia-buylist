"use client";

import { useMemo, useState } from "react";

type CondKey = "NMEX" | "GDLP";
type CondMap = Record<CondKey, number>;

// --- helpers ---
const round2 = (n: number) => Math.round(n * 100) / 100;

type CartItem = { idProduct: number; isFoil: boolean; qty: number; cond?: CondKey };
type QuoteLine = { idProduct: number; isFoil: boolean; unit: number; available: boolean };

export default function BuylistPage({
  payoutPct,
  condMap,
}: {
  payoutPct: number; // bv. 0.70 – komt uit server wrapper page.tsx
  condMap: CondMap;  // { NMEX: 1.0, GDLP: 0.9 }
}) {
  // state
  const [items, setItems] = useState<CartItem[]>([]);
  const [email, setEmail] = useState("");
  const [quotes, setQuotes] = useState<QuoteLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // add-item form
  const [form, setForm] = useState<{ idProduct: string; isFoil: boolean; qty: number }>({
    idProduct: "",
    isFoil: false,
    qty: 1,
  });

  /** Build lookup map from quotes */
  const byKey = useMemo(() => {
    const m = new Map<string, QuoteLine>();
    for (const q of quotes ?? []) m.set(`${q.idProduct}-${q.isFoil ? 1 : 0}`, q);
    return m;
  }, [quotes]);

  /** Merge duplicates → rows */
  const rows = useMemo(() => {
    const merged = new Map<string, CartItem>();
    for (const it of items) {
      const key = `${it.idProduct}-${it.isFoil ? 1 : 0}`;
      const cur = merged.get(key);
      if (cur) cur.qty += it.qty;
      else merged.set(key, { ...it, cond: it.cond ?? "NMEX" });
    }
    return Array.from(merged.values()).map((it) => {
      const key = `${it.idProduct}-${it.isFoil ? 1 : 0}`;
      const q = byKey.get(key);
      const serverUnit = q?.unit ?? 0;            // trend (EUR) van server, geen korting
      const cond = it.cond ?? "NMEX";
      const condMult = condMap[cond] ?? 1.0;      // NMEX=1.0, GDLP=0.9
      const paidUnit = round2(serverUnit * payoutPct * condMult);
      const lineTotal = round2(paidUnit * it.qty);
      return {
        ...it,
        cond,
        serverUnit,        // trend unit (EUR)
        unit: paidUnit,    // uitbetaald per unit
        lineTotal,
        available: q?.available ?? false,
      };
    });
  }, [items, byKey, payoutPct, condMap]);

  const total = useMemo(() => round2(rows.reduce((s, r) => s + r.lineTotal, 0)), [rows]);

  /** Actions */
  function addItem() {
    const id = Number(form.idProduct);
    const qty = Math.max(1, Number(form.qty) || 1);

    if (!Number.isInteger(id)) {
      setMsg({ type: "err", text: "Vul een geldig idProduct in." });
      return;
    }

    setItems((prev) => {
      const idx = prev.findIndex((p) => p.idProduct === id && p.isFoil === form.isFoil);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: Number(next[idx].qty || 1) + qty };
        return next;
      }
      return [...prev, { idProduct: id, isFoil: form.isFoil, qty, cond: "NMEX" }];
    });

    setForm((f) => ({ ...f, idProduct: "", qty: 1 }));
    setMsg(null);
  }

  function updateQty(idProduct: number, isFoil: boolean, qty: number) {
    const q = Math.max(1, Number(qty) || 1);
    setItems((prev) =>
      prev.map((p) =>
        p.idProduct === idProduct && p.isFoil === isFoil ? { ...p, qty: q } : p
      )
    );
  }

  function updateCond(idProduct: number, isFoil: boolean, cond: CondKey) {
    setItems((prev) =>
      prev.map((p) =>
        p.idProduct === idProduct && p.isFoil === isFoil ? { ...p, cond } : p
      )
    );
  }

  function removeItem(idProduct: number, isFoil: boolean) {
    setItems((prev) => prev.filter((p) => !(p.idProduct === idProduct && p.isFoil === isFoil)));
  }

  async function fetchQuotes() {
    if (rows.length === 0) {
      setMsg({ type: "err", text: "Mandje is leeg." });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      // Stuur GEMERGEDE rows naar quote-API (zonder pct!)
      const res = await fetch(`/api/prices/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: rows.map((r) => ({ idProduct: r.idProduct, isFoil: r.isFoil, qty: r.qty })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Quote mislukt");
      setQuotes(data.quotes as QuoteLine[]);
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Kon geen quotes ophalen." });
    } finally {
      setLoading(false);
    }
  }

  async function submitCart() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setMsg({ type: "err", text: "Voer een geldig e-mailadres in." });
      return;
    }
    if (rows.length === 0) {
      setMsg({ type: "err", text: "Mandje is leeg." });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cart/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          items: rows.map((r) => ({
            idProduct: r.idProduct,
            isFoil: r.isFoil,
            qty: r.qty,
            cond: r.cond ?? "NMEX",
          })),
          meta: { payoutPct, clientTotal: total }, // snapshot voor admin
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Insturen mislukt");
      setMsg({ type: "ok", text: "Bedankt! Je buylist is ingestuurd." });
      setItems([]);
      setQuotes(null);
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Insturen mislukt." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold">Buylist v0.3</h1>
            <p className="text-sm opacity-70">Voeg idProduct + foil toe, vraag quotes, stuur in.</p>
          </div>
          <a className="text-sm underline underline-offset-4 hover:opacity-80" href="/submissions">
            Submissions →
          </a>
        </header>

        {msg && (
          <div
            className={`rounded-xl p-3 text-sm ${
              msg.type === "ok" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* Add item */}
        <section className="grid gap-3 rounded-2xl border p-4 shadow-sm">
          <h2 className="font-semibold">Kaart toevoegen</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <label className="block text-xs opacity-70">idProduct</label>
              <input
                className="mt-1 w-full rounded-xl border p-2"
                placeholder="bv. 10"
                value={form.idProduct}
                onChange={(e) => setForm((f) => ({ ...f, idProduct: e.target.value }))}
                inputMode="numeric"
              />
            </div>
            <label className="flex items-end gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.isFoil}
                onChange={(e) => setForm((f) => ({ ...f, isFoil: e.target.checked }))}
              />
              <span className="text-sm">Foil</span>
            </label>
            <div className="flex items-end">
              <input
                type="number"
                min={1}
                className="w-24 rounded-xl border p-2"
                value={form.qty}
                onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value || 1) }))}
              />
            </div>
            <div className="flex items-end">
              <button onClick={addItem} className="w-full rounded-xl border p-2 hover:bg-gray-50">
                + Toevoegen
              </button>
            </div>
          </div>
          <p className="text-xs opacity-60">Tip: voeg dezelfde id nogmaals toe om qty te verhogen.</p>
        </section>

        {/* Cart + controls */}
        <section className="grid gap-3 rounded-2xl border p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Mandje</h2>
            <div className="text-sm opacity-70">
              Uitbetaal-%: <strong>{Math.round(payoutPct * 100)}%</strong>
            </div>
            <button
              onClick={fetchQuotes}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              disabled={loading || rows.length === 0}
              aria-busy={loading}
            >
              {loading ? "Quoten…" : "Vraag quotes"}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-2 py-2 text-left">idProduct</th>
                  <th className="px-2 py-2 text-left">Foil</th>
                  <th className="px-2 py-2 text-left">Conditie</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Unit (server)</th>
                  <th className="px-2 py-2 text-right">Unit × %</th>
                  <th className="px-2 py-2 text-right">Totaal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center opacity-60">
                      Nog geen items.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={`${r.idProduct}-${r.isFoil ? 1 : 0}`} className="border-b">
                      <td className="px-2 py-2">{r.idProduct}</td>
                      <td className="px-2 py-2">{r.isFoil ? "Yes" : "No"}</td>
                      <td className="px-2 py-2">
                        <select
                          className="border rounded px-2 py-1 text-sm"
                          value={r.cond ?? "NMEX"}
                          onChange={(e) => updateCond(r.idProduct, r.isFoil, e.target.value as CondKey)}
                        >
                          <option value="NMEX">NM/EX</option>
                          <option value="GDLP">GD/LP (-10%)</option>
                        </select>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          min={1}
                          className="w-20 rounded border p-1 text-right"
                          value={r.qty}
                          onChange={(e) =>
                            updateQty(r.idProduct, r.isFoil, Number(e.target.value || 1))
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">€ {r.serverUnit.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">€ {r.unit.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right font-medium tabular-nums">
                        € {r.lineTotal.toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                          onClick={() => removeItem(r.idProduct, r.isFoil)}
                        >
                          Verwijder
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} />
                  <td className="px-2 py-3 text-right text-lg font-semibold tabular-nums">
                    € {total.toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <input
                className="w-72 rounded-xl border p-2"
                type="email"
                placeholder="jij@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <span className="text-xs opacity-60">We sturen de bevestiging hierheen.</span>
            </div>
            <button
              onClick={submitCart}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50"
              disabled={submitting || rows.length === 0}
              aria-busy={submitting}
            >
              {submitting ? "Insturen…" : "Buylist insturen"}
            </button>
          </div>
        </section>

        {/* Quick seeds */}
        <section className="rounded-2xl border p-4 text-xs opacity-70">
          <div className="mb-2 font-medium">Sneltest</div>
          <div className="flex flex-wrap gap-2">
            {[{ idProduct: 4, isFoil: false }, { idProduct: 8, isFoil: true }, { idProduct: 10, isFoil: true }].map(
              (s) => (
                <button
                  key={`${s.idProduct}-${s.isFoil ? 1 : 0}`}
                  className="rounded-lg border px-2 py-1 hover:bg-gray-50"
                  onClick={() =>
                    setItems((prev) => {
                      const idx = prev.findIndex(
                        (p) => p.idProduct === s.idProduct && p.isFoil === s.isFoil
                      );
                      if (idx !== -1) {
                        const next = [...prev];
                        next[idx] = { ...next[idx], qty: Number(next[idx].qty || 1) + 1 };
                        return next;
                      }
                      return [...prev, { idProduct: s.idProduct, isFoil: s.isFoil, qty: 1, cond: "NMEX" }];
                    })
                  }
                >
                  + {s.idProduct} {s.isFoil ? "(foil)" : ""}
                </button>
              )
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
