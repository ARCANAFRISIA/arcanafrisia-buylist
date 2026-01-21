"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PlanRow = {
  lotId: string;
  location: string | null;
  qty: number;
  cardmarketId: number;
  blueprintId: number | null;
  set: string;
  name: string;
  collectorNumber: string | null;
  condition: string;
  language: string;
  isFoil: boolean;
  sourceCode: string;
  sourceDate: string;
  priceEur: number | null;
  priceSource: string;
};

export default function Ct1DayTool() {
  const [minPrice, setMinPrice] = useState("1");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const totalQty = useMemo(() => (plan ?? []).reduce((a, r) => a + (r.qty ?? 0), 0), [plan]);

  async function loadPlan() {
    setLoading(true); setErr(null); setOut(null);
    try {
      const p = new URLSearchParams();
      p.set("format", "json");
      p.set("minPrice", minPrice || "1");
      const res = await fetch(`/api/admin/ct1day/plan?${p.toString()}`, { method: "GET" });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body));
      setPlan(body.plan ?? []);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    const p = new URLSearchParams();
    p.set("format", "csv");
    p.set("minPrice", minPrice || "1");
    window.open(`/api/admin/ct1day/plan?${p.toString()}`, "_blank");
  }

  async function apply(simulate: boolean) {
    setLoading(true); setErr(null); setOut(null);
    try {
      if (!plan?.length) throw new Error("No plan loaded");

      const items = plan.map(r => ({ lotId: r.lotId, qty: r.qty }));
      const res = await fetch(`/api/admin/ct1day/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ simulate, items }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body));
      setOut(body);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">CT 1Day Ready (from CTBULK)</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Picks CTBULK lots with CT minPrice ≥ threshold (fallback CM trend). Generates a picklist and can book them out.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm mb-1 text-zinc-200">Min price (EUR)</label>
            <Input
              value={minPrice}
              onChange={e => setMinPrice(e.target.value)}
              placeholder="1"
              className="bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
            />
          </div>

          <Button onClick={loadPlan} disabled={loading} className="min-w-[160px]">
            {loading ? "Loading…" : "Load plan"}
          </Button>

          <Button onClick={downloadCsv} disabled={!plan?.length || loading} variant="outline" className="border-zinc-700">
            Download CSV
          </Button>

          <div className="text-sm text-zinc-300">
            {plan ? (
              <div className="space-y-1">
                <div>Lots: <span className="text-zinc-100 font-semibold">{plan.length}</span></div>
                <div>Total qty: <span className="text-zinc-100 font-semibold">{totalQty}</span></div>
              </div>
            ) : (
              <div className="text-zinc-400">Load a plan to see totals.</div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => apply(true)} disabled={!plan?.length || loading} variant="outline" className="border-zinc-700">
            Apply (simulate)
          </Button>
          <Button onClick={() => apply(false)} disabled={!plan?.length || loading}>
            Apply (run)
          </Button>
        </div>

        {err && (
          <pre className="bg-red-950/40 border border-red-900/50 text-red-200 p-3 rounded-xl text-sm overflow-x-auto">
            {err}
          </pre>
        )}

        {out && (
          <pre className="bg-zinc-900 border border-zinc-800 text-zinc-100 p-3 rounded-xl text-sm overflow-x-auto">
            {JSON.stringify(out, null, 2)}
          </pre>
        )}
      </div>

      {plan?.length ? (
        <div className="rounded-2xl border border-zinc-800 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-900">
              <tr className="text-zinc-200">
                <th className="px-3 py-2 text-left">Loc</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-left">Card</th>
                <th className="px-3 py-2 text-left">Set</th>
                <th className="px-3 py-2 text-left">Cond</th>
                <th className="px-3 py-2 text-left">Lang</th>
                <th className="px-3 py-2 text-right">€</th>
                <th className="px-3 py-2 text-left">Src</th>
              </tr>
            </thead>
            <tbody className="text-zinc-100">
              {plan.slice(0, 250).map((r) => (
                <tr key={r.lotId} className="border-t border-zinc-800 hover:bg-zinc-900/40">
                  <td className="px-3 py-2 font-mono text-zinc-200">{r.location ?? ""}</td>
                  <td className="px-3 py-2 text-right">{r.qty}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-zinc-300">{r.set}</td>
                  <td className="px-3 py-2">{r.condition}</td>
                  <td className="px-3 py-2">{r.language}{r.isFoil ? " (F)" : ""}</td>
                  <td className="px-3 py-2 text-right">{r.priceEur ?? ""}</td>
                  <td className="px-3 py-2 text-zinc-300">{r.priceSource}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-2 text-xs text-zinc-500">
            Showing first 250 rows. Use CSV for the full list.
          </div>
        </div>
      ) : null}
    </div>
  );
}
