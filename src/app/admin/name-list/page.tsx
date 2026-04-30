"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type NameListRow = {
  index: number;
  inputName: string;
  matchedName: string;
  matched: boolean;
  cardmarketId: number | null;
  tcgplayerId: number | null;
  scryfallId: string | null;
  oracleId: string | null;
  name: string;
  set: string | null;
  collectorNumber: string | null;
  lang: string | null;
  imageSmall: string | null;
  imageNormal: string | null;
  rarity: string | null;
  usd: number | null;
  eur: number | null;
  tix: number | null;
  edhrecRank: number | null;
  gameChanger: boolean;
  trendPriceEur: number | null;
  foilTrendPriceEur: number | null;
  priceUpdatedAt: string | null;
  scryfallUpdatedAt: string | null;
  printCount: number;
  minTrendPriceEur: number | null;
  maxTrendPriceEur: number | null;
  ownStockQty: number;
  ownStock: boolean;
};

type ApiResponse = {
  ok: boolean;
  count?: number;
  matched?: number;
  unmatched?: number;
  owned?: number;
  missingOwnStock?: number;
  rows?: NameListRow[];
  error?: string;
};

type SortKey =
  | "index"
  | "name"
  | "set"
  | "collectorNumber"
  | "rarity"
  | "edhrecRank"
  | "trendPriceEur"
  | "foilTrendPriceEur"
  | "eur"
  | "tix"
  | "printCount"
  | "minTrendPriceEur"
  | "maxTrendPriceEur"
  | "ownStockQty"
  | "missingPriority";

type SortDir = "asc" | "desc";

function formatNumber(value: number | null, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "-";
  }

  return Number(value).toLocaleString("nl-NL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatInt(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "-";
  }

  return Number(value).toLocaleString("nl-NL", {
    maximumFractionDigits: 0,
  });
}

function compareValues(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
  dir: SortDir
) {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";

  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;

  let result = 0;

  if (typeof a === "string" && typeof b === "string") {
    result = a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  } else {
    result = Number(a) - Number(b);
  }

  return dir === "asc" ? result : -result;
}

function compareMissingPriority(a: NameListRow, b: NameListRow, dir: SortDir) {
  // Missing own stock eerst.
  const aMissing = a.matched && a.ownStockQty <= 0 ? 0 : 1;
  const bMissing = b.matched && b.ownStockQty <= 0 ? 0 : 1;

  if (aMissing !== bMissing) {
    const result = aMissing - bMissing;
    return dir === "asc" ? result : -result;
  }

  // Daarna beste EDHREC rank bovenaan.
  const aEdh = a.edhrecRank ?? Number.MAX_SAFE_INTEGER;
  const bEdh = b.edhrecRank ?? Number.MAX_SAFE_INTEGER;

  if (aEdh !== bEdh) {
    const result = aEdh - bEdh;
    return dir === "asc" ? result : -result;
  }

  // Daarna hoogste trend.
  const aTrend = a.trendPriceEur ?? -1;
  const bTrend = b.trendPriceEur ?? -1;

  if (aTrend !== bTrend) {
    const result = bTrend - aTrend;
    return dir === "asc" ? result : -result;
  }

  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function escapeCsv(value: string | number | boolean | null) {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: NameListRow[]) {
  const headers = [
    "index",
    "inputName",
    "matchedName",
    "matched",
    "ownStock",
    "ownStockQty",
    "cardmarketId",
    "tcgplayerId",
    "name",
    "set",
    "collectorNumber",
    "rarity",
    "edhrecRank",
    "gameChanger",
    "trendPriceEur",
    "foilTrendPriceEur",
    "minTrendPriceEur",
    "maxTrendPriceEur",
    "eur",
    "usd",
    "tix",
    "printCount",
    "imageSmall",
    "scryfallId",
    "oracleId",
  ];

  const lines = rows.map((row) =>
    [
      row.index,
      row.inputName,
      row.matchedName,
      row.matched,
      row.ownStock,
      row.ownStockQty,
      row.cardmarketId,
      row.tcgplayerId,
      row.name,
      row.set,
      row.collectorNumber,
      row.rarity,
      row.edhrecRank,
      row.gameChanger,
      row.trendPriceEur,
      row.foilTrendPriceEur,
      row.minTrendPriceEur,
      row.maxTrendPriceEur,
      row.eur,
      row.usd,
      row.tix,
      row.printCount,
      row.imageSmall,
      row.scryfallId,
      row.oracleId,
    ]
      .map(escapeCsv)
      .join(",")
  );

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

export default function AdminNameListPage() {
  const [rows, setRows] = useState<NameListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [setFilter, setSetFilter] = useState("all");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [matchFilter, setMatchFilter] = useState<"all" | "matched" | "unmatched">(
    "all"
  );
  const [stockFilter, setStockFilter] = useState<"all" | "owned" | "missing">(
    "all"
  );
  const [gameChangerFilter, setGameChangerFilter] = useState<
    "all" | "yes" | "no"
  >("all");

  const [hideNoTrend, setHideNoTrend] = useState(false);
  const [minTrend, setMinTrend] = useState("");
  const [maxEdhrecRank, setMaxEdhrecRank] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("missingPriority");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/admin/name-list", {
          cache: "no-store",
        });

        const json: ApiResponse = await res.json();

        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? "Kon name-list niet laden");
        }

        if (!cancelled) {
          setRows(json.rows ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const setOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => row.set).filter((v): v is string => Boolean(v)))
    ).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const rarityOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((row) => row.rarity).filter((v): v is string => Boolean(v)))
    ).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minTrendNum = minTrend.trim() === "" ? null : Number(minTrend);
    const maxEdhNum =
      maxEdhrecRank.trim() === "" ? null : Number(maxEdhrecRank);

    return rows
      .filter((row) => {
        if (matchFilter === "matched" && !row.matched) return false;
        if (matchFilter === "unmatched" && row.matched) return false;

        if (stockFilter === "owned" && row.ownStockQty <= 0) return false;
        if (stockFilter === "missing" && row.ownStockQty > 0) return false;

        if (gameChangerFilter === "yes" && !row.gameChanger) return false;
        if (gameChangerFilter === "no" && row.gameChanger) return false;

        if (hideNoTrend && !row.trendPriceEur) return false;

        if (q) {
          const hay = `${row.inputName} ${row.matchedName} ${row.name} ${
            row.set ?? ""
          } ${row.collectorNumber ?? ""} ${row.cardmarketId ?? ""}`.toLowerCase();

          if (!hay.includes(q)) return false;
        }

        if (setFilter !== "all" && row.set !== setFilter) return false;
        if (rarityFilter !== "all" && row.rarity !== rarityFilter) return false;

        if (
          minTrendNum !== null &&
          (row.trendPriceEur === null || row.trendPriceEur < minTrendNum)
        ) {
          return false;
        }

        if (
          maxEdhNum !== null &&
          (row.edhrecRank === null || row.edhrecRank > maxEdhNum)
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortKey === "missingPriority") {
          return compareMissingPriority(a, b, sortDir);
        }

        const aVal = a[sortKey] as string | number | boolean | null;
        const bVal = b[sortKey] as string | number | boolean | null;
        return compareValues(aVal, bVal, sortDir);
      });
  }, [
    rows,
    search,
    setFilter,
    rarityFilter,
    matchFilter,
    stockFilter,
    gameChangerFilter,
    hideNoTrend,
    minTrend,
    maxEdhrecRank,
    sortKey,
    sortDir,
  ]);

  const summary = useMemo(() => {
    const matched = rows.filter((row) => row.matched).length;
    const unmatched = rows.length - matched;

    const owned = rows.filter((row) => row.ownStockQty > 0).length;
    const missing = rows.filter(
      (row) => row.matched && row.ownStockQty <= 0
    ).length;

    const gameChangers = rows.filter((row) => row.gameChanger).length;

    const withTrend = rows.filter(
      (row) => row.trendPriceEur !== null && row.trendPriceEur > 0
    ).length;

    const avgTrendRows = rows.filter(
      (row) => row.trendPriceEur !== null && row.trendPriceEur > 0
    );

    const avgTrend =
      avgTrendRows.length > 0
        ? avgTrendRows.reduce((sum, row) => sum + Number(row.trendPriceEur), 0) /
          avgTrendRows.length
        : null;

    return {
      total: rows.length,
      filtered: filteredRows.length,
      matched,
      unmatched,
      owned,
      missing,
      gameChangers,
      withTrend,
      avgTrend,
    };
  }, [rows, filteredRows]);

  function handleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDir(
      nextKey === "name" ||
        nextKey === "set" ||
        nextKey === "collectorNumber" ||
        nextKey === "rarity" ||
        nextKey === "index" ||
        nextKey === "edhrecRank" ||
        nextKey === "ownStockQty" ||
        nextKey === "missingPriority"
        ? "asc"
        : "desc"
    );
  }

  function handleResetFilters() {
    setSearch("");
    setSetFilter("all");
    setRarityFilter("all");
    setMatchFilter("all");
    setStockFilter("all");
    setGameChangerFilter("all");
    setHideNoTrend(false);
    setMinTrend("");
    setMaxEdhrecRank("");
    setSortKey("missingPriority");
    setSortDir("asc");
  }

  function handleExport() {
    const csv = toCsv(filteredRows);
    const filename = `name-list-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(filename, csv);
  }

  return (
    <main className="min-h-screen bg-[#07111F] text-white">
      <div className="mx-auto max-w-[1700px] px-4 py-6 md:px-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">
              MTGO Commander Workshop
            </h1>
            <p className="mt-1 text-sm text-white/85">
              Vaste namenlijst verrijkt met Scryfall, EDHREC, Cardmarket trend
              en eigen voorraad per kaartnaam.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setStockFilter("missing");
                setSortKey("missingPriority");
                setSortDir("asc");
              }}
              className="rounded border border-[#C9A24E] bg-[#C9A24E] px-4 py-2 text-sm font-medium text-black hover:opacity-90"
            >
              Missing priority
            </button>

            <button
              type="button"
              onClick={handleExport}
              disabled={filteredRows.length === 0}
              className="rounded border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mb-6 grid gap-3 rounded-2xl border border-white/15 bg-white/5 p-4 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Zoeken
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Naam, set, CN of CM ID"
              className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white caret-white outline-none placeholder:text-white/50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Match
            </label>
            <select
              value={matchFilter}
              onChange={(e) =>
                setMatchFilter(e.target.value as "all" | "matched" | "unmatched")
              }
              className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white outline-none"
            >
              <option value="all">Alles</option>
              <option value="matched">Matched</option>
              <option value="unmatched">Unmatched</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Own stock
            </label>
            <select
              value={stockFilter}
              onChange={(e) =>
                setStockFilter(e.target.value as "all" | "owned" | "missing")
              }
              className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white outline-none"
            >
              <option value="all">Alles</option>
              <option value="owned">Owned</option>
              <option value="missing">Missing</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Gamechanger
            </label>
            <select
              value={gameChangerFilter}
              onChange={(e) =>
                setGameChangerFilter(e.target.value as "all" | "yes" | "no")
              }
              className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white outline-none"
            >
              <option value="all">Alles</option>
              <option value="yes">Alleen ja</option>
              <option value="no">Alleen nee</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Set
            </label>
            <select
              value={setFilter}
              onChange={(e) => setSetFilter(e.target.value)}
              className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white outline-none"
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
              Rarity
            </label>
            <select
              value={rarityFilter}
              onChange={(e) => setRarityFilter(e.target.value)}
              className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white outline-none"
            >
              <option value="all">Alle rarities</option>
              {rarityOptions.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {rarity}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Min trend €
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={minTrend}
              onChange={(e) => setMinTrend(e.target.value)}
              className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-white/85">
              Max EDHREC rank
            </label>
            <input
              type="number"
              step="1"
              min="0"
              value={maxEdhrecRank}
              onChange={(e) => setMaxEdhrecRank(e.target.value)}
              className="w-full rounded border border-white/20 bg-[#0B1A2B] px-3 py-2 text-sm text-white outline-none"
            />
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2 text-sm text-white">
              <input
                type="checkbox"
                checked={hideNoTrend}
                onChange={(e) => setHideNoTrend(e.target.checked)}
                className="h-4 w-4"
              />
              Verberg zonder trend
            </label>
          </div>

          <div className="md:col-span-6">
            <div className="flex flex-wrap gap-2">
              <SortButton
                label="Missing + EDHREC"
                sortKey="missingPriority"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Own stock"
                sortKey="ownStockQty"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="#"
                sortKey="index"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
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
                label="Rarity"
                sortKey="rarity"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="EDHREC"
                sortKey="edhrecRank"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Trend €"
                sortKey="trendPriceEur"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Foil trend €"
                sortKey="foilTrendPriceEur"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Tix"
                sortKey="tix"
                currentKey={sortKey}
                currentDir={sortDir}
                onChange={handleSort}
              />
              <SortButton
                label="Prints"
                sortKey="printCount"
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

        <div className="mb-4 grid gap-3 md:grid-cols-8">
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">
              Total
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatInt(summary.total)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">
              Filtered
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatInt(summary.filtered)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">
              Matched
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatInt(summary.matched)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">
              Unmatched
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatInt(summary.unmatched)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">
              Owned
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatInt(summary.owned)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">
              Missing
            </div>
            <div className="mt-1 text-2xl font-semibold text-[#C9A24E]">
              {formatInt(summary.missing)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">
              Gamechanger
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatInt(summary.gameChangers)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-wide text-white/80">
              Avg trend €
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {formatNumber(summary.avgTrend)}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/15 bg-white/5">
          {loading ? (
            <div className="p-6 text-sm text-white/85">Laden...</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-6 text-sm text-white/85">Geen resultaten.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/10 text-left text-white/95">
                  <tr>
                    <th className="px-3 py-3">Card</th>
                    <th className="px-3 py-3">Own</th>
                    <th className="px-3 py-3">Set</th>
                    <th className="px-3 py-3">CN</th>
                    <th className="px-3 py-3">Rarity</th>
                    <th className="px-3 py-3">CM ID</th>
                    <th className="px-3 py-3">EDHREC</th>
                    <th className="px-3 py-3">Trend €</th>
                    <th className="px-3 py-3">Foil €</th>
                    <th className="px-3 py-3">Min €</th>
                    <th className="px-3 py-3">Max €</th>
                    <th className="px-3 py-3">EUR</th>
                    <th className="px-3 py-3">Tix</th>
                    <th className="px-3 py-3">Prints</th>
                    <th className="px-3 py-3">Status</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={`${row.index}-${row.inputName}-${row.cardmarketId ?? "missing"}`}
                      className="border-t border-white/10 align-top"
                    >
                      <td className="px-3 py-3">
                        <div className="flex min-w-[280px] items-start gap-3">
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
                            <div className="font-semibold text-white">
                              {row.name}
                            </div>
                            <div className="text-xs text-white/70">
                              Input: {row.inputName}
                            </div>
                            {row.inputName !== row.matchedName ? (
                              <div className="text-xs text-white/50">
                                Alias: {row.matchedName}
                              </div>
                            ) : null}
                            {row.gameChanger ? (
                              <div className="mt-1 inline-flex rounded border border-[#C9A24E]/40 bg-[#C9A24E]/15 px-2 py-0.5 text-[11px] text-[#F0D98A]">
                                Gamechanger
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        {row.ownStockQty > 0 ? (
                          <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">
                            yes · {formatInt(row.ownStockQty)}
                          </span>
                        ) : (
                          <span className="rounded border border-[#C9A24E]/40 bg-[#C9A24E]/10 px-2 py-1 text-xs text-[#F0D98A]">
                            missing
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-white/90">
                        {row.set ?? "-"}
                      </td>
                      <td className="px-3 py-3 text-white/90">
                        {row.collectorNumber ?? "-"}
                      </td>
                      <td className="px-3 py-3 text-white/90">
                        {row.rarity ?? "-"}
                      </td>
                      <td className="px-3 py-3 text-white/90">
                        {row.cardmarketId ?? "-"}
                      </td>
                      <td className="px-3 py-3 text-white">
                        {formatInt(row.edhrecRank)}
                      </td>
                      <td className="px-3 py-3 font-semibold text-[#C9A24E]">
                        {formatNumber(row.trendPriceEur)}
                      </td>
                      <td className="px-3 py-3 text-white">
                        {formatNumber(row.foilTrendPriceEur)}
                      </td>
                      <td className="px-3 py-3 text-white">
                        {formatNumber(row.minTrendPriceEur)}
                      </td>
                      <td className="px-3 py-3 text-white">
                        {formatNumber(row.maxTrendPriceEur)}
                      </td>
                      <td className="px-3 py-3 text-white">
                        {formatNumber(row.eur)}
                      </td>
                      <td className="px-3 py-3 text-white">
                        {formatNumber(row.tix, 3)}
                      </td>
                      <td className="px-3 py-3 text-white">
                        {formatInt(row.printCount)}
                      </td>
                      <td className="px-3 py-3">
                        {row.matched ? (
                          <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">
                            matched
                          </span>
                        ) : (
                          <span className="rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-xs text-red-200">
                            missing match
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}