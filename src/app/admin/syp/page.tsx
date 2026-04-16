"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type SypPhase = "release" | "stabilized" | "mature";

type SypRow = {
  cardmarketId: number;
  name: string;
  set: string;
  collectorNumber: string;
  imageSmall: string;
  phase: SypPhase;
  effectiveTix: number;
  priceEur: number;
  qtyOnHand: number;
  targetQty: number;
  neededQty: number;
};

type SypResponse = {
  ok: boolean;
  count: number;
  rows: SypRow[];
};

type TabKey = "new" | "old";
type SortKey =
  | "name"
  | "set"
  | "collectorNumber"
  | "phase"
  | "effectiveTix"
  | "priceEur"
  | "qtyOnHand"
  | "targetQty"
  | "neededQty";

type SortDir = "asc" | "desc";

function formatNumber(n: number, digits = 2) {
  return Number(n ?? 0).toLocaleString("nl-NL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatInt(n: number) {
  return Number(n ?? 0).toLocaleString("nl-NL", {
    maximumFractionDigits: 0,
  });
}

function compareValues(a: string | number, b: string | number, dir: SortDir) {
  let result = 0;

  if (typeof a === "string" && typeof b === "string") {
    result = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  } else {
    result = Number(a) - Number(b);
  }

  return dir === "asc" ? result : -result;
}

function toCsv(rows: SypRow[]) {
  const headers = [
    "cardmarketId",
    "name",
    "set",
    "collectorNumber",
    "phase",
    "effectiveTix",
    "priceEur",
    "qtyOnHand",
    "targetQty",
    "neededQty",
    "estimatedBuyCostEur",
    "scoreTixPerEuro",
    "imageSmall",
  ];

  const escape = (value: string | number) => {
    const s = String(value ?? "");
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = rows.map((row) => {
    const estimatedBuyCostEur = row.neededQty * row.priceEur;
    const scoreTixPerEuro = row.priceEur > 0 ? row.effectiveTix / row.priceEur : 0;

    return [
      row.cardmarketId,
      row.name,
      row.set,
      row.collectorNumber,
      row.phase,
      row.effectiveTix,
      row.priceEur,
      row.qtyOnHand,
      row.targetQty,
      row.neededQty,
      estimatedBuyCostEur,
      scoreTixPerEuro,
      row.imageSmall,
    ]
      .map(escape)
      .join(",");
  });

  return [headers.join(","), ...lines].join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function SortButton(props: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onChange: (key: SortKey) => void;
}) {
  const { label, sortKey, currentKey, currentDir, onChange } = props;
  const active = sortKey === currentKey;

  return (
    <button
      type="button"
      onClick={() => onChange(sortKey)}
      className={`rounded border px-3 py-2 text-sm ${
        active
          ? "border-[#C9A24E] bg-[#C9A24E]/15 text-white"
          : "border-white/20 bg-white/10 text-white hover:bg-white/15"
      }`}
    >
      {label}
      {active ? (currentDir === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );
}

export default function AdminSypPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("new");

  const [newData, setNewData] = useState<SypRow[]>([]);
  const [oldData, setOldData] = useState<SypRow[]>([]);

  const [loadingNew, setLoadingNew] = useState(true);
  const [loadingOld, setLoadingOld] = useState(true);

  const [errorNew, setErrorNew] = useState<string | null>(null);
  const [errorOld, setErrorOld] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [setFilter, setSetFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState<"all" | SypPhase>("all");
  const [minNeeded, setMinNeeded] = useState("");
  const [minTix, setMinTix] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [hideNoPrice, setHideNoPrice] = useState(true);

  const [sortKey, setSortKey] = useState<SortKey>("effectiveTix");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoadingNew(true);
        setErrorNew(null);

        const res = await fetch("/api/syp/new?limit=5000", {
          cache: "no-store",
        });
        const json: SypResponse = await res.json();

        if (!res.ok || !json.ok) {
          throw new Error("Kon /api/syp/new niet laden");
        }

        if (!cancelled) setNewData(json.rows ?? []);
      } catch (err) {
        if (!cancelled) {
          setErrorNew(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) setLoadingNew(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoadingOld(true);
        setErrorOld(null);

        const res = await fetch("/api/syp/old?limit=10000", {
          cache: "no-store",
        });
        const json: SypResponse = await res.json();

        if (!res.ok || !json.ok) {
          throw new Error("Kon /api/syp/old niet laden");
        }

        if (!cancelled) setOldData(json.rows ?? []);
      } catch (err) {
        if (!cancelled) {
          setErrorOld(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) setLoadingOld(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentRows = activeTab === "new" ? newData : oldData;
  const loading = activeTab === "new" ? loadingNew : loadingOld;
  const error = activeTab === "new" ? errorNew : errorOld;

  const setOptions = useMemo(() => {
    return Array.from(new Set(currentRows.map((r) => r.set))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [currentRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minNeededNum = minNeeded.trim() === "" ? null : Number(minNeeded);
    const minTixNum = minTix.trim() === "" ? null : Number(minTix);
    const minPriceNum = minPrice.trim() === "" ? null : Number(minPrice);

    return currentRows
      .filter((row) => {
        if (hideNoPrice && row.priceEur <= 0) return false;

        if (q) {
          const hay =
            `${row.name} ${row.set} ${row.collectorNumber} ${row.cardmarketId}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }

        if (setFilter !== "all" && row.set !== setFilter) return false;
        if (phaseFilter !== "all" && row.phase !== phaseFilter) return false;
        if (minNeededNum !== null && row.neededQty < minNeededNum) return false;
        if (minTixNum !== null && row.effectiveTix < minTixNum) return false;
        if (minPriceNum !== null && row.priceEur < minPriceNum) return false;

        return true;
      })
      .sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        return compareValues(aVal as string | number, bVal as string | number, sortDir);
      });
  }, [
    currentRows,
    search,
    setFilter,
    phaseFilter,
    minNeeded,
    minTix,
    minPrice,
    hideNoPrice,
    sortKey,
    sortDir,
  ]);

  const summary = useMemo(() => {
    let totalNeeded = 0;
    let totalEstimatedBuy = 0;

    for (const row of filteredRows) {
      totalNeeded += row.neededQty;
      totalEstimatedBuy += row.neededQty * row.priceEur;
    }

    return {
      rowCount: filteredRows.length,
      totalNeeded,
      totalEstimatedBuy,
    };
  }, [filteredRows]);

  function handleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDir(
      nextKey === "name" ||
        nextKey === "set" ||
        nextKey === "phase" ||
        nextKey === "collectorNumber"
        ? "asc"
        : "desc"
    );
  }

  function handleExport() {
    const csv = toCsv(filteredRows);
    const filename = `syp-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(filename, csv);
  }

  function handleResetFilters() {
    setSearch("");
    setSetFilter("all");
    setPhaseFilter("all");
    setMinNeeded("");
    setMinTix("");
    setMinPrice("");
    setHideNoPrice(true);
    setSortKey("effectiveTix");
    setSortDir("desc");
  }

  return (
    <main className="min-h-screen bg-[#07111F] text-white">
      <div className="mx-auto max-w-[1700px] px-4 py-6 md:px-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">SYP</h1>
            <p className="mt-1 text-sm text-white/85">
              Overzicht van needed voorraad voor New en Old buckets.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("new")}
              className={`rounded border px-4 py-2 text-sm font-medium ${
                activeTab === "new"
                  ? "border-[#C9A24E] bg-[#C9A24E]/15 text-white"
                  : "border-white/20 bg-white/10 text-white hover:bg-white/15"
              }`}
            >
              New ({newData.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("old")}
              className={`rounded border px-4 py-2 text-sm font-medium ${
                activeTab === "old"
                  ? "border-[#C9A24E] bg-[#C9A24E]/15 text-white"
                  : "border-white/20 bg-white/10 text-white hover:bg-white/15"
              }`}
            >
              Old ({oldData.length})
            </button>

            <button
              type="button"
              onClick={handleExport}
              className="rounded border border-[#C9A24E] bg-[#C9A24E] px-4 py-2 text-sm font-medium text-black hover:opacity-90"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="mb-6 grid gap-3 rounded-2xl border border-white/15 bg-white/5 p-4 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Zoeken
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Naam, set, cn of cardmarketId"
              style={{ color: "white" }}
className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white caret-white outline-none placeholder:text-white/50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Set
            </label>
            <select
              value={setFilter}
              onChange={(e) => setSetFilter(e.target.value)}
              style={{ color: "white" }}
className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white caret-white outline-none placeholder:text-white/50"
            >
              <option value="all">Alle sets</option>
              {setOptions.map((setCode) => (
                <option key={setCode} value={setCode}>
                  {setCode}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Phase
            </label>
            <select
              value={phaseFilter}
              onChange={(e) => setPhaseFilter(e.target.value as "all" | SypPhase)}
              style={{ color: "white" }}
className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white caret-white outline-none placeholder:text-white/50"
            >
              <option value="all">Alle phases</option>
              <option value="release">release</option>
              <option value="stabilized">stabilized</option>
              <option value="mature">mature</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Min needed
            </label>
            <input
              type="number"
              step="1"
              min="0"
              value={minNeeded}
              onChange={(e) => setMinNeeded(e.target.value)}
              className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white outline-none placeholder:text-white/50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Min tix
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={minTix}
              onChange={(e) => setMinTix(e.target.value)}
              style={{ color: "white" }}
className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white caret-white outline-none placeholder:text-white/50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Min price €
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              style={{ color: "white" }}
className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white caret-white outline-none placeholder:text-white/50"
            />
          </div>

          <div className="md:col-span-6">
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={hideNoPrice}
                onChange={(e) => setHideNoPrice(e.target.checked)}
                className="h-4 w-4"
              />
              Verberg kaarten zonder prijs
            </label>
          </div>

          <div className="md:col-span-6">
            <div className="flex flex-wrap gap-2">
              <SortButton
                label="Name"
                sortKey="name"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Set"
                sortKey="set"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="CN"
                sortKey="collectorNumber"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Phase"
                sortKey="phase"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Tix"
                sortKey="effectiveTix"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Price €"
                sortKey="priceEur"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="On hand"
                sortKey="qtyOnHand"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Target"
                sortKey="targetQty"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Needed"
                sortKey="neededQty"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />

              <button
                type="button"
                onClick={handleResetFilters}
                className="rounded border border-white/20 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15"
              >
                Reset filters
              </button>
            </div>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">Rows</div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatInt(summary.rowCount)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">
              Total needed qty
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatInt(summary.totalNeeded)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">
              Estimated buy cost €
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatNumber(summary.totalEstimatedBuy)}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/15 bg-white/5">
          {loading ? (
            <div className="p-6 text-sm text-white/85">Laden...</div>
          ) : error ? (
            <div className="p-6 text-sm text-red-300">{error}</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-6 text-sm text-white/85">Geen resultaten.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/10 text-left text-white/95">
                  <tr>
                    <th className="px-3 py-3">Card</th>
                    <th className="px-3 py-3">Set</th>
                    <th className="px-3 py-3">CN</th>
                    <th className="px-3 py-3">Phase</th>
                    <th className="px-3 py-3">CM ID</th>
                    <th className="px-3 py-3">Tix</th>
                    <th className="px-3 py-3">Price €</th>
                    <th className="px-3 py-3">On hand</th>
                    <th className="px-3 py-3">Target</th>
                    <th className="px-3 py-3">Needed</th>
                    <th className="px-3 py-3">Est. buy €</th>
                    <th className="px-3 py-3">Tix/€</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const estBuy = row.neededQty * row.priceEur;
                    const score = row.priceEur > 0 ? row.effectiveTix / row.priceEur : 0;

                    return (
                      <tr
                        key={`${row.cardmarketId}-${row.set}`}
                        className="border-t border-white/10 align-top"
                      >
                        <td className="px-3 py-3">
                          <div className="flex min-w-[260px] items-start gap-3">
                            <div className="h-[52px] w-[38px] shrink-0 overflow-hidden rounded border border-white/15 bg-[#0B1A2B]">
                              {row.imageSmall ? (
                                <Image
                                  src={row.imageSmall}
                                  alt={row.name}
                                  width={38}
                                  height={52}
                                  className="h-full w-full object-cover"
                                  unoptimized
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] text-white/50">
                                  No img
                                </div>
                              )}
                            </div>

                            <div>
                              <div className="font-semibold text-white">{row.name}</div>
                              <div className="text-xs text-white/75">
                                {row.set.toUpperCase()} {row.collectorNumber ? `#${row.collectorNumber}` : ""}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-3 text-white/90">{row.set}</td>
                        <td className="px-3 py-3 text-white/90">{row.collectorNumber || "-"}</td>
                        <td className="px-3 py-3 text-white/90">{row.phase}</td>
                        <td className="px-3 py-3 text-white/90">{row.cardmarketId}</td>
                        <td className="px-3 py-3 text-white">{formatNumber(row.effectiveTix)}</td>
                        <td className="px-3 py-3 text-white">{formatNumber(row.priceEur)}</td>
                        <td className="px-3 py-3 text-white">{formatInt(row.qtyOnHand)}</td>
                        <td className="px-3 py-3 text-white">{formatInt(row.targetQty)}</td>
                        <td className="px-3 py-3 font-semibold text-[#C9A24E]">
                          {formatInt(row.neededQty)}
                        </td>
                        <td className="px-3 py-3 text-white">{formatNumber(estBuy)}</td>
                        <td className="px-3 py-3 text-white">{formatNumber(score, 3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}