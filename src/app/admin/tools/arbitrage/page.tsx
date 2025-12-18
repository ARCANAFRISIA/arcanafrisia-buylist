"use client";

import { useEffect, useState } from "react";

type ArbitrageCandidate = {
  cardmarketId: number;
  name: string | null;
  set: string | null;
  collectorNumber: string | null;
  trend: number;
  ctMin: number;
  wishPrice: number;
  profitAbs: number;
  profitPct: number;
  maxBuy: number;
};

type SortKey =
  | "profitAbs"
  | "profitPct"
  | "ctMin"
  | "trend"
  | "name";

export default function ArbitragePage() {
  const [data, setData] = useState<ArbitrageCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("profitAbs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [minProfitEuro, setMinProfitEuro] = useState<number>(0);
  const [minProfitPctFilter, setMinProfitPctFilter] = useState<number>(0);
  const [search, setSearch] = useState<string>("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          "/api/providers/cm/wants/apply-format?format=arbitrage",
          { method: "GET" }
        );
        const json = await res.json();
        if (json.ok && Array.isArray(json.candidates)) {
          setData(json.candidates);
        } else {
          console.error("Invalid response", json);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = data.filter((c) => {
    if (minProfitEuro > 0 && c.profitAbs < minProfitEuro) return false;
    if (minProfitPctFilter > 0 && c.profitPct * 100 < minProfitPctFilter) {
      return false;
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      const name = (c.name ?? "").toLowerCase();
      const setCode = (c.set ?? "").toLowerCase();
      if (!name.includes(q) && !setCode.includes(q)) return false;
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "profitAbs":
        return (a.profitAbs - b.profitAbs) * dir;
      case "profitPct":
        return (a.profitPct - b.profitPct) * dir;
      case "ctMin":
        return (a.ctMin - b.ctMin) * dir;
      case "trend":
        return (a.trend - b.trend) * dir;
      case "name": {
        const an = (a.name ?? "").toLowerCase();
        const bn = (b.name ?? "").toLowerCase();
        if (an < bn) return -1 * dir;
        if (an > bn) return 1 * dir;
        return 0;
      }
      default:
        return 0;
    }
  });

  function handleSort(newKey: SortKey) {
    if (newKey === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(newKey);
      setSortDir("desc");
    }
  }

  if (loading) {
    return <div className="p-4 text-white">Arbitrage-lijst laden...</div>;
  }

  return (
    <div className="p-4 text-sm text-white">
      <h1 className="text-2xl font-semibold mb-4">AF Arbitrage preview</h1>
      <p className="mb-4 opacity-80">
        Dit zijn de top arbitrage-kaarten (max 150) op basis van CT-min vs CM-data.
        Gebruik dit om eerst handmatig te scannen / carts te vullen voordat je de MKM-wantslist bijwerkt.
      </p>

      <div className="flex flex-wrap gap-3 items-end mb-4 text-xs">
        <div>
          <label className="block mb-1 opacity-70">Min profit €</label>
          <input
            type="number"
            step="0.10"
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 w-24"
            value={minProfitEuro}
            onChange={(e) => setMinProfitEuro(Number(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="block mb-1 opacity-70">Min profit %</label>
          <input
            type="number"
            step="1"
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 w-24"
            value={minProfitPctFilter}
            onChange={(e) =>
              setMinProfitPctFilter(Number(e.target.value) || 0)
            }
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block mb-1 opacity-70">Zoek (naam of set)</label>
          <input
            type="text"
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="b.v. Chrome Mox, ema, 2xm..."
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-700">
        <table className="min-w-full border-collapse">
          <thead className="bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th
                className="px-3 py-2 text-left cursor-pointer"
                onClick={() => handleSort("name")}
              >
                Card
              </th>
              <th className="px-3 py-2 text-left">Set</th>
              <th
                className="px-3 py-2 text-right cursor-pointer"
                onClick={() => handleSort("ctMin")}
              >
                CT min
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer"
                onClick={() => handleSort("trend")}
              >
                CM trend
              </th>
              <th className="px-3 py-2 text-right">Wish</th>
              <th
                className="px-3 py-2 text-right cursor-pointer"
                onClick={() => handleSort("profitAbs")}
              >
                Profit €
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer"
                onClick={() => handleSort("profitPct")}
              >
                Profit %
              </th>
              <th className="px-3 py-2 text-right">Max buy</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, idx) => (
              <tr
                key={`${c.cardmarketId}-${idx}`}
                className={
                  idx % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/40"
                }
              >
                <td className="px-3 py-1">{idx + 1}</td>
                <td className="px-3 py-1">
                  {c.name ?? c.cardmarketId}
                </td>
                <td className="px-3 py-1">
                  {c.set ?? "-"}
                  {c.collectorNumber ? ` #${c.collectorNumber}` : ""}
                </td>
                <td className="px-3 py-1 text-right">
                  {c.ctMin.toFixed(2)} €
                </td>
                <td className="px-3 py-1 text-right">
                  {c.trend.toFixed(2)} €
                </td>
                <td className="px-3 py-1 text-right">
                  {c.wishPrice.toFixed(2)} €
                </td>
                <td className="px-3 py-1 text-right">
                  {c.profitAbs.toFixed(2)} €
                </td>
                <td className="px-3 py-1 text-right">
                  {(c.profitPct * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-1 text-right">
                  {c.maxBuy}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
