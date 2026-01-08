"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LotRow = {
  id: string;
  qtyRemaining: number;
  sourceCode: string | null;
  sourceDate: string;
  location: string | null;
};

type Item = {
  skuKey: string;
  cardmarketId: number;
  name: string;
  set: string;
  collectorNumber: string | null;
  isFoil: boolean;
  condition: string;
  language: string;
  qtyOnHand: number;
  stockClass: "CORE" | "COMMANDER";
  currentLocations: string[];
  suggestedLocation: string | null;
  lots: LotRow[];
};

type BackfillResult = {
  ok: boolean;
  dryRun?: boolean;
  scanned?: number;
  updated?: number;
  errors?: { lotId: string; message: string }[];
  message?: string;
  note?: string;
  error?: string;
};

export default function LocationWorklistPage() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [onlyMissingLocation, setOnlyMissingLocation] = useState(true);

  const [lastBackfill, setLastBackfill] = useState<BackfillResult | null>(null);

  // per lotId editable newLocation
  const [locByLotId, setLocByLotId] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/location/worklist?includeLots=1", { method: "GET" });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Load failed (${res.status})`);
      setItems(body.items ?? []);

      // prefill: suggested for missing, else existing
      const pre: Record<string, string> = {};
      for (const it of (body.items ?? []) as Item[]) {
        for (const lot of it.lots) {
          if (!lot.location && it.suggestedLocation) pre[lot.id] = it.suggestedLocation;
          else if (lot.location) pre[lot.id] = lot.location;
        }
      }
      setLocByLotId(pre);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (onlyMissingLocation) {
        const hasMissing = it.lots.some((l) => !l.location);
        if (!hasMissing) return false;
      }
      if (!q) return true;
      return (
        String(it.cardmarketId).includes(q) ||
        it.name.toLowerCase().includes(q) ||
        it.set.toLowerCase().includes(q) ||
        (it.collectorNumber ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, query, onlyMissingLocation]);

  async function apply() {
    setApplying(true);
    setError(null);
    try {
      const moves: { lotId: string; newLocation: string }[] = [];
      for (const it of filtered) {
        for (const lot of it.lots) {
          const v = (locByLotId[lot.id] ?? "").trim();
          if (!v) continue;
          if (lot.location !== v) moves.push({ lotId: lot.id, newLocation: v });
        }
      }

      if (!moves.length) {
        setError("Geen wijzigingen om toe te passen.");
        return;
      }

      const res = await fetch("/api/admin/location/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves }),
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Apply failed (${res.status})`);

      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setApplying(false);
    }
  }

  async function runBackfill(dryRun: boolean) {
    setBackfilling(true);
    setError(null);
    setLastBackfill(null);
    try {
      const url = `/api/admin/location/backfill-missing?${dryRun ? "dryRun=1&" : ""}limit=2000`;
      const res = await fetch(url, { method: "POST" });
      const body = (await res.json()) as BackfillResult;
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Backfill failed (${res.status})`);
      setLastBackfill(body);

      // bij echte apply: refresh worklist
      if (!dryRun) {
        await load();
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Location worklist (CORE / COMMANDER)</h1>
          <div className="text-sm opacity-80">
            Doel: oude stock CORE/COMMANDER verplaatsen naar C01-02 / C03-06. Geen qty wijzigingen.
          </div>
          <div className="text-xs opacity-70 mt-1">
            Eerst: Backfill voor missing locations (holding in REGULAR ranges). Daarna: worklist moves naar C.
          </div>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <Button onClick={() => runBackfill(true)} disabled={loading || applying || backfilling}>
            {backfilling ? "Backfill…" : "Backfill (dry-run)"}
          </Button>
          <Button onClick={() => runBackfill(false)} disabled={loading || applying || backfilling}>
            {backfilling ? "Backfill…" : "Backfill (apply)"}
          </Button>

          <Button onClick={load} disabled={loading || backfilling}>
            {loading ? "Laden…" : "Refresh"}
          </Button>

          <Button onClick={apply} disabled={applying || loading || backfilling} className="min-w-[140px]">
            {applying ? "Opslaan…" : "Apply moves"}
          </Button>
        </div>
      </div>

      {error && (
        <pre className="bg-red-950/40 text-red-200 p-3 rounded text-xs whitespace-pre-wrap">{error}</pre>
      )}

      {lastBackfill && (
        <pre className="bg-black/40 p-3 rounded text-xs whitespace-pre-wrap">
          {JSON.stringify(lastBackfill, null, 2)}
        </pre>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek op naam, set, cn, cardmarketId…"
          className="max-w-[420px]"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyMissingLocation}
            onChange={(e) => setOnlyMissingLocation(e.target.checked)}
          />
          Alleen lots zonder location
        </label>
        <div className="text-sm opacity-80">Resultaat: {filtered.length} items</div>
      </div>

      <div className="space-y-6">
        {filtered.map((it) => (
          <div key={it.skuKey} className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-lg font-semibold">
                  {it.name}{" "}
                  <span className="text-sm opacity-70">
                    ({it.set}{it.collectorNumber ? ` #${it.collectorNumber}` : ""})
                  </span>
                </div>
                <div className="text-sm opacity-80">
                  cmid {it.cardmarketId} • {it.stockClass} • {it.condition} • {it.language}
                  {it.isFoil ? " • FOIL" : ""} • onHand: {it.qtyOnHand}
                </div>
                <div className="text-sm opacity-70">
                  Huidige locaties: {it.currentLocations.length ? it.currentLocations.join(", ") : "—"}
                </div>
                <div className="text-sm opacity-70">Suggestie: {it.suggestedLocation ?? "—"}</div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-black/30">
                  <tr>
                    <th className="text-left p-2">lotId</th>
                    <th className="text-right p-2">qty</th>
                    <th className="text-left p-2">source</th>
                    <th className="text-left p-2">sourceDate</th>
                    <th className="text-left p-2">current</th>
                    <th className="text-left p-2">new location</th>
                    <th className="text-left p-2">quick</th>
                  </tr>
                </thead>
                <tbody>
                  {it.lots.map((l) => (
                    <tr key={l.id} className="odd:bg-black/10">
                      <td className="p-2 font-mono text-xs">{l.id}</td>
                      <td className="p-2 text-right">{l.qtyRemaining}</td>
                      <td className="p-2">{l.sourceCode ?? "—"}</td>
                      <td className="p-2">{String(l.sourceDate).slice(0, 10)}</td>
                      <td className="p-2">{l.location ?? "—"}</td>
                      <td className="p-2">
                        <input
                          className="w-[120px] rounded-md border px-2 py-1 bg-black/20 font-mono text-xs"
                          value={locByLotId[l.id] ?? ""}
                          onChange={(e) =>
                            setLocByLotId((prev) => ({ ...prev, [l.id]: e.target.value }))
                          }
                          placeholder="C03.01"
                        />
                      </td>
                      <td className="p-2">
                        {it.suggestedLocation && (
                          <button
                            className="rounded-md border px-2 py-1 text-xs hover:opacity-90"
                            onClick={() =>
                              setLocByLotId((prev) => ({ ...prev, [l.id]: it.suggestedLocation! }))
                            }
                          >
                            use suggestion
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {it.lots.length === 0 && (
                    <tr>
                      <td className="p-2 opacity-70" colSpan={7}>
                        Geen lots gevonden (alleen balances). Dit is een data-integrity issue (kan na oude rebuilds).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-xs opacity-70">
              Tip: begin met CORE (C01-02), daarna COMMANDER (C03-06). “Backfill (apply)” eerst draaien als lots nog geen location hebben.
            </div>
          </div>
        ))}

        {filtered.length === 0 && !loading && (
          <div className="text-sm opacity-70">Niks te doen 🎉 (of je filter is te streng).</div>
        )}
      </div>
    </div>
  );
}
