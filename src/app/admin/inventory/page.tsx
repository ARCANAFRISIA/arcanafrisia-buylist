// src/app/admin/inventory/page.tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type InventoryItem = {
  id: number;
  cardmarketId: number;
  isFoil: boolean;
  condition: string;
  language: string | null;
  qtyOnHand: number;
  avgUnitCostEur: number | null;
  lastSaleAt: string | null;
  name: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;
  sourceCode: string | null;
  cmTrendEur: number | null;
  ctMinEur: number | null;
};

type ApiResponse = {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: InventoryItem[];
  error?: string;
};

export default function InventoryOverviewPage() {
  const [search, setSearch] = useState("");
  const [includeZero, setIncludeZero] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("");
const [setFilter, setSetFilter] = useState("");
const [onlyPlayed, setOnlyPlayed] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // fetch helper
  async function load(p = page) {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (includeZero) params.set("includeZero", "1");
      params.set("page", String(p));
      params.set("pageSize", String(pageSize));
      if (sourceFilter.trim()) params.set("source", sourceFilter.trim());
if (setFilter.trim()) params.set("set", setFilter.trim().toUpperCase());
if (onlyPlayed) params.set("onlyPlayed", "1");


      const res = await fetch(`/api/admin/inventory/overview?${params.toString()}`);
      const body: ApiResponse = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Request failed: ${res.status}`);
      }
      setData(body);
      setPage(body.page);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }


  // eerste load
  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
const formatMoney = (v: number | null | undefined) =>
  v != null && !isNaN(v) ? v.toFixed(2) : "-";

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Inventory overview</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end">
  <div className="flex flex-col gap-1">
    <label className="text-sm">Zoek (naam of CM id)</label>
    <Input
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Bijv. Fury, 824869..."
      className="w-64"
    />
  </div>

  <div className="flex flex-col gap-1">
    <label className="text-sm">Set code</label>
    <Input
      value={setFilter}
      onChange={(e) => setSetFilter(e.target.value)}
      placeholder="Bijv. MH3"
      className="w-24"
    />
  </div>

  <div className="flex flex-col gap-1">
    <label className="text-sm">Source code</label>
    <Input
      value={sourceFilter}
      onChange={(e) => setSourceFilter(e.target.value)}
      placeholder="Bijv. DSK270125"
      className="w-32"
    />
  </div>

  <label className="flex items-center gap-2 text-sm mt-6">
    <input
      type="checkbox"
      checked={includeZero}
      onChange={(e) => setIncludeZero(e.target.checked)}
    />
    Toon ook 0 voorraad
  </label>

  <label className="flex items-center gap-2 text-sm mt-6">
    <input
      type="checkbox"
      checked={onlyPlayed}
      onChange={(e) => setOnlyPlayed(e.target.checked)}
    />
    Alleen played (GD/LP/PL/PO)
  </label>

  <Button
    onClick={() => load(1)}
    disabled={loading}
    className="mt-6"
  >
    {loading ? "Laden..." : "Zoeken / verversen"}
  </Button>
</div>


      {/* Error */}
      {err && (
        <div className="text-sm text-red-400">
          {err}
        </div>
      )}

      {/* Tabel */}
     <table className="w-full text-sm">
  <thead className="bg-black/30">
    <tr>
      <th className="p-2 text-left">Card</th>
      <th className="p-2 text-left">Set</th>
      <th className="p-2 text-left">CM id</th>
      <th className="p-2 text-left">Foil</th>
      <th className="p-2 text-left">Cond</th>
      <th className="p-2 text-left">Lang</th>
      <th className="p-2 text-right">Qty</th>
      <th className="p-2 text-right">Avg cost</th>
      <th className="p-2 text-right">CM trend</th>
      <th className="p-2 text-right">CT min</th>
      <th className="p-2 text-left">Source</th>
      <th className="p-2 text-left">Last sale</th>
    </tr>
  </thead>

  <tbody>
    {data?.items?.length ? (
      data.items.map((item, idx) => (
        <tr
          key={`${item.id}-${item.cardmarketId}-${item.isFoil ? "F" : "N"}-${item.condition}-${idx}`}
          className="odd:bg-black/10 align-middle"
        >
          {/* Card + plaatje */}
          <td className="p-2">
            <div className="flex items-center gap-2">
              {item.imageUrl && (
                <img
                  src={item.imageUrl}
                  alt={item.name ?? "card"}
                  className="w-12 h-16 object-cover rounded border border-zinc-800"
                />
              )}
              <div>
                <div className="font-medium text-sm">
                  {item.name ?? "—"}
                </div>
                <div className="text-xs text-zinc-400">
                  {item.collectorNumber ?? ""}
                </div>
              </div>
            </div>
          </td>

          {/* Set */}
          <td className="p-2">{item.setCode ?? "-"}</td>

          {/* CM id */}
          <td className="p-2">{item.cardmarketId}</td>

          {/* Foil */}
          <td className="p-2">{item.isFoil ? "Foil" : "-"}</td>

          {/* Cond */}
          <td className="p-2">{item.condition}</td>

          {/* Language */}
          <td className="p-2">{item.language ?? "-"}</td>

          {/* Qty */}
          <td className="p-2 text-right">{item.qtyOnHand}</td>

          {/* Avg cost */}
          <td className="p-2 text-right">
            {formatMoney(item.avgUnitCostEur)}
          </td>

          {/* CM trend */}
          <td className="p-2 text-right">
            {formatMoney(item.cmTrendEur)}
          </td>

          {/* CT min */}
          <td className="p-2 text-right">
            {formatMoney(item.ctMinEur)}
          </td>

          {/* Source code (FIFO lot) */}
          <td className="p-2">{item.sourceCode ?? "-"}</td>

          {/* Last sale (datum/tijd) */}
          <td className="p-2 text-xs">
            {item.lastSaleAt
              ? new Date(item.lastSaleAt).toLocaleString("nl-NL")
              : "-"}
          </td>
        </tr>
      ))
    ) : (
      <tr>
        <td colSpan={11} className="p-3 text-center text-zinc-400">
          Geen resultaten.
        </td>
      </tr>
    )}
  </tbody>
</table>


      {/* Pagination */}
      {data && (
        <div className="flex justify-between items-center text-sm">
          <div>
            Totaal: {data.total} SKUs · Pagina {data.page} / {totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => load(page - 1)}
            >
              Vorige
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages || loading}
              onClick={() => load(page + 1)}
            >
              Volgende
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
