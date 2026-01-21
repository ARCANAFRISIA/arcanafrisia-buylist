"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type SypRow = {
  tcgplayerId: number;
  tcgProductId: number | null;

  category: string;
  productName: string;
  setName: string | null;
  condition: string | null;
  rarity: string | null;
  collectorNumber: string | null;
  marketPrice: number | null;
  maxQty: number;

  cardmarketId: number | null;
  setCode: string | null;

  qtyHave: number;
  gap: number;
};

type ApiResponse = {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: SypRow[];
  error?: string;
  debug?: any;
};

type FacetsResponse = {
  ok: boolean;
  sets: string[];
  conditions: string[];
  error?: string;
};

type SortKey = "set" | "name" | "maxQty";
type SortDir = "asc" | "desc";
type InvMode = "sumAll" | "bestSingle" | "strict";

const formatMoney = (v: number | null | undefined) =>
  v != null && !isNaN(v) ? v.toFixed(2) : "-";

export default function SypOverviewPage() {
  const [search, setSearch] = useState("");

  const [setFilter, setSetFilter] = useState("");
  const [condFilter, setCondFilter] = useState("");

  const [sets, setSets] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);

  const [invMode, setInvMode] = useState<InvMode>("sumAll");

  const [sort1, setSort1] = useState<SortKey>("maxQty");
  const [dir1, setDir1] = useState<SortDir>("desc");
  const [sort2, setSort2] = useState<SortKey>("set");
  const [dir2, setDir2] = useState<SortDir>("asc");

  const [page, setPage] = useState(1);
  const [pageSize] = useState(150); // ✅ requested

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const debounceRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const inputClass =
    "!text-white !placeholder:text-zinc-500 !bg-zinc-900/60 !border-zinc-700 focus:!ring-1 focus:!ring-zinc-500 caret-white selection:bg-white/20";

  const selectClass =
    "h-10 rounded-md border border-zinc-700 bg-zinc-900/60 px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-zinc-500";

  async function loadFacets() {
    try {
      const res = await fetch("/api/admin/syp/facets", { cache: "no-store" });
      const body: FacetsResponse = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || "facets failed");

      setSets(body.sets ?? []);
      setConditions(body.conditions ?? []);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function load(p = page) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setErr(null);

    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (setFilter) params.set("set", setFilter);
      if (condFilter) params.set("condition", condFilter);

      params.set("invMode", invMode);

      params.set("sort1", sort1);
      params.set("dir1", dir1);
      params.set("sort2", sort2);
      params.set("dir2", dir2);

      params.set("page", String(p));
      params.set("pageSize", String(pageSize));

      const res = await fetch(`/api/admin/syp/overview?${params.toString()}`, {
        cache: "no-store",
        signal: ac.signal,
      });

      const body: ApiResponse = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || `Request failed: ${res.status}`);

      setData(body);
      setPage(body.page);
    } catch (e: any) {
      if (e?.name !== "AbortError") setErr(e?.message ?? String(e));
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }

  useEffect(() => {
    loadFacets();
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(1), 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, setFilter, condFilter, sort1, dir1, sort2, dir2, invMode]);

  return (
    <div className="p-6 space-y-6 text-zinc-100">
      <h1 className="text-2xl font-semibold">SYP demand overview</h1>

      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-sm text-zinc-200">Zoek (naam of TCG id)</label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Bijv. Fury, 123456..."
            className={`w-64 ${inputClass}`}
            style={{ color: "#fff" }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-zinc-200">Set</label>
          <select
            className={`${selectClass} w-72`}
            value={setFilter}
            onChange={(e) => setSetFilter(e.target.value)}
          >
            <option value="">(alle sets)</option>
            {sets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-zinc-200">Condition</label>
          <select
            className={`${selectClass} w-52`}
            value={condFilter}
            onChange={(e) => setCondFilter(e.target.value)}
          >
            <option value="">(alle cond)</option>
            {conditions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-zinc-200">Inventory match</label>
          <select
            className={`${selectClass} w-56`}
            value={invMode}
            onChange={(e) => setInvMode(e.target.value as InvMode)}
          >
            <option value="sumAll">Sum all (id)</option>
            <option value="bestSingle">Best single (id)</option>
            <option value="strict">Strict (id+cond EN nonfoil)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-zinc-200">Sort #1</label>
          <div className="flex gap-2">
            <select className={selectClass} value={sort1} onChange={(e) => setSort1(e.target.value as SortKey)}>
              <option value="maxQty">maxQty</option>
              <option value="set">set</option>
              <option value="name">name</option>
            </select>
            <select className={selectClass} value={dir1} onChange={(e) => setDir1(e.target.value as SortDir)}>
              <option value="desc">desc</option>
              <option value="asc">asc</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-zinc-200">Sort #2</label>
          <div className="flex gap-2">
            <select className={selectClass} value={sort2} onChange={(e) => setSort2(e.target.value as SortKey)}>
              <option value="set">set</option>
              <option value="name">name</option>
              <option value="maxQty">maxQty</option>
            </select>
            <select className={selectClass} value={dir2} onChange={(e) => setDir2(e.target.value as SortDir)}>
              <option value="asc">asc</option>
              <option value="desc">desc</option>
            </select>
          </div>
        </div>

        <Button onClick={() => load(1)} disabled={loading} className="mt-6 whitespace-nowrap">
          {loading ? "Laden..." : "Zoeken / verversen"}
        </Button>

        {loading && <div className="mt-7 text-xs text-zinc-400">Laden…</div>}
      </div>

      {err && <div className="text-sm text-red-400">{err}</div>}

      <table className="w-full text-sm">
        <thead className="bg-black/30">
          <tr>
            <th className="p-2 text-left">Card</th>
            <th className="p-2 text-left">Set</th>
            <th className="p-2 text-left">Cond</th>
            <th className="p-2 text-right">maxQty</th>
            <th className="p-2 text-right">On hand</th>
            <th className="p-2 text-right">GAP</th>
            <th className="p-2 text-right">Market</th>
            <th className="p-2 text-left">TCG sku</th>
            <th className="p-2 text-left">TCG prod</th>
            <th className="p-2 text-left">CM id</th>
          </tr>
        </thead>

        <tbody>
          {data?.items?.length ? (
            data.items.map((r, idx) => (
              <tr
                key={`${r.tcgplayerId}-${r.condition ?? "?"}-${idx}`}
                className="odd:bg-black/10 align-middle"
              >
                <td className="p-2">
                  <div className="font-medium text-sm">{r.productName}</div>
                  <div className="text-xs text-zinc-400">
                    {r.collectorNumber ?? ""} {r.setCode ? `· ${r.setCode.toUpperCase()}` : ""}
                  </div>
                </td>

                <td className="p-2">{r.setName ?? "-"}</td>
                <td className="p-2">{r.condition ?? "-"}</td>

                <td className="p-2 text-right font-medium">{r.maxQty}</td>
                <td className="p-2 text-right">{r.qtyHave}</td>

                <td className="p-2 text-right">
                  <span className={r.gap > 0 ? "text-amber-300 font-semibold" : "text-zinc-400"}>
                    {r.gap}
                  </span>
                </td>

                <td className="p-2 text-right">{formatMoney(r.marketPrice)}</td>
                <td className="p-2">{r.tcgplayerId}</td>
                <td className="p-2">{r.tcgProductId ?? "-"}</td>
                <td className="p-2">{r.cardmarketId ?? "-"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={10} className="p-3 text-center text-zinc-400">
                Geen resultaten.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {data && (
        <div className="flex justify-between items-center text-sm">
          <div>
            Totaal: {data.total} SYP regels · Pagina {data.page} / {totalPages}
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
