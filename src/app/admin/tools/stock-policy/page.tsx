"use client";

import { useEffect, useMemo, useState } from "react";

type StockClass = "CORE" | "REGULAR" | "CTBULK";

type Row = {
  cardmarketId: number;
  scryfallId: string;
  name: string;
  set: string;
  collectorNumber: string | null;
  rarity: string | null;
  eur: number | null;
  tix: number | null;
  edhrecRank: number | null;
  gameChanger: boolean | null;
  updatedAt: string; // ISO
  stockClass: StockClass;
};

type SetRow = { set: string; count: number };

type SortKey = "name" | "eur" | "tix" | "edh" | "updatedAt";
type SortDir = "asc" | "desc";

async function fetchRows(setCode: string, q: string): Promise<Row[]> {
  const url =
    `/api/admin/stock-policy/cards?set=${encodeURIComponent(setCode)}` +
    (q.trim() ? `&q=${encodeURIComponent(q.trim())}` : "");
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Failed to load");
  return json.cards as Row[];
}

async function fetchSets(): Promise<SetRow[]> {
  const res = await fetch("/api/admin/stock-policy/sets", {
    method: "GET",
    cache: "no-store",
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Failed to load sets");
  return json.sets as SetRow[];
}

async function saveClass(scryfallId: string, stockClass: StockClass) {
  const res = await fetch("/api/admin/stock-policy/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scryfallId, stockClass }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Save failed");
}

export default function StockPolicyToolPage() {
  const [sets, setSets] = useState<SetRow[]>([]);
  const [setCode, setSetCode] = useState("mh2");
  const [search, setSearch] = useState("");
  const [onlyCore, setOnlyCore] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("tix");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [setsErr, setSetsErr] = useState<string | null>(null);

  async function loadRows() {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchRows(setCode.toLowerCase().trim(), search);
      setRows(data);
    } catch (e: any) {
      setErr(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadSets() {
    setSetsErr(null);
    try {
      const data = await fetchSets();
      setSets(data);

      // als huidige setCode niet bestaat in lijst, pak eerste
      if (data.length > 0) {
        const exists = data.some((s) => s.set === setCode.toLowerCase().trim());
        if (!exists) setSetCode(data[0].set);
      }
    } catch (e: any) {
      setSetsErr(e?.message || "Sets load failed");
    }
  }

  useEffect(() => {
    loadSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // init load
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c = { CORE: 0, REGULAR: 0, CTBULK: 0 };
    for (const r of rows) c[r.stockClass]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const base = onlyCore ? rows.filter((r) => r.stockClass === "CORE") : rows;
    return base;
  }, [rows, onlyCore]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const xs = [...filtered];

    const num = (v: number | null | undefined, fallback: number) =>
      v == null ? fallback : v;

    xs.sort((a, b) => {
      switch (sortKey) {
        case "eur": {
          // nulls onderaan
          const av = num(a.eur, -1);
          const bv = num(b.eur, -1);
          return (av - bv) * dir;
        }
        case "tix": {
          const av = num(a.tix, -1);
          const bv = num(b.tix, -1);
          return (av - bv) * dir;
        }
        case "edh": {
          // EDH rank: lager = beter; nulls onderaan
          const av = num(a.edhrecRank, 99999999);
          const bv = num(b.edhrecRank, 99999999);
          return (av - bv) * dir;
        }
        case "updatedAt": {
          const av = Date.parse(a.updatedAt) || 0;
          const bv = Date.parse(b.updatedAt) || 0;
          return (av - bv) * dir;
        }
        case "name":
        default: {
          const an = (a.name ?? "").toLowerCase();
          const bn = (b.name ?? "").toLowerCase();
          if (an < bn) return -1 * dir;
          if (an > bn) return 1 * dir;
          // tie-breaker
          const acn = (a.collectorNumber ?? "").toLowerCase();
          const bcn = (b.collectorNumber ?? "").toLowerCase();
          if (acn < bcn) return -1 * dir;
          if (acn > bcn) return 1 * dir;
          return 0;
        }
      }
    });

    return xs;
  }, [filtered, sortKey, sortDir]);

  async function setClass(row: Row, next: StockClass) {
    if (row.stockClass === next) return;

    setErr(null);
    setSaving(row.scryfallId);

    const prev = row.stockClass;

    // optimistic
    setRows((xs) =>
      xs.map((x) =>
        x.scryfallId === row.scryfallId ? { ...x, stockClass: next } : x
      )
    );

    try {
      await saveClass(row.scryfallId, next);
    } catch (e: any) {
      // rollback
      setRows((xs) =>
        xs.map((x) =>
          x.scryfallId === row.scryfallId ? { ...x, stockClass: prev } : x
        )
      );
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(null);
    }
  }

  function ClassButton({
    row,
    label,
    value,
  }: {
    row: Row;
    label: string;
    value: StockClass;
  }) {
    const active = row.stockClass === value;
    const busy = saving === row.scryfallId;

    const cls =
      "px-2 py-1 rounded border text-xs whitespace-nowrap " +
    (active
  ? value === "CORE"
    ? "border-yellow-400 bg-yellow-500/20"
    : value === "CTBULK"
    ? "border-orange-400 bg-orange-500/20"
    : "border-zinc-300/40 bg-zinc-500/20"
  : "border-zinc-700 bg-zinc-900 hover:bg-zinc-800");


    return (
      <button
        className={cls}
        disabled={busy}
        onClick={() => setClass(row, value)}
        title={`Set ${value}`}
      >
        {label}
      </button>
    );
  }

  const currentSetLabel = useMemo(() => {
    const found = sets.find((s) => s.set === setCode.toLowerCase().trim());
    if (!found) return setCode.toUpperCase();
    return `${found.set.toUpperCase()} (${found.count})`;
  }, [sets, setCode]);

  if (loading) {
    return <div className="p-4 text-white">Stock policy laden...</div>;
  }

  return (
    <div className="p-4 text-sm text-white">
      <div className="flex flex-col gap-2 mb-3">
        <h1 className="text-2xl font-semibold">
          Stock Policy (CORE / REGULAR / CTBULK)
        </h1>
        <p className="opacity-80">
          Markeer kaarten per set. CORE = staple dozen, REGULAR = normale voorraad,
          CTBULK = naar bulk account.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end mb-4 text-xs">
        <div>
          <label className="block mb-1 opacity-70">Set</label>
          <select
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono min-w-[160px]"
            value={setCode}
            onChange={(e) => setSetCode(e.target.value)}
          >
            {sets.length === 0 ? (
              <option value={setCode}>{setCode.toUpperCase()}</option>
            ) : (
              sets.map((s) => (
                <option key={s.set} value={s.set}>
                  {s.set.toUpperCase()} ({s.count})
                </option>
              ))
            )}
          </select>
          <div className="mt-1 text-[11px] opacity-60">
            Current: {currentSetLabel}
          </div>
          {setsErr && (
            <div className="mt-1 text-[11px] text-red-300">
              Sets error: {setsErr}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-[220px]">
          <label className="block mb-1 opacity-70">Zoek (naam)</label>
          <input
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Arid Mesa"
          />
        </div>

        <div>
          <label className="block mb-1 opacity-70">Sort</label>
          <select
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="tix">TIX</option>
            <option value="eur">EUR</option>
            <option value="edh">EDH rank</option>
            <option value="name">Name</option>
            <option value="updatedAt">UpdatedAt</option>
          </select>
        </div>

        <button
          className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 hover:bg-zinc-800"
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          title="Toggle sort direction"
        >
          {sortDir === "asc" ? "Asc" : "Desc"}
        </button>

        <button
          className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 hover:bg-zinc-800"
          onClick={loadRows}
          title="Reload cards for selected set"
        >
          Load
        </button>

        <label className="flex items-center gap-2 opacity-80">
          <input
            type="checkbox"
            checked={onlyCore}
            onChange={(e) => setOnlyCore(e.target.checked)}
          />
          Only CORE
        </label>

        <div className="opacity-70">
          CORE {counts.CORE} · REG {counts.REGULAR} · CTB {counts.CTBULK} · Total{" "}
          {rows.length}
        </div>
      </div>

      {err && (
        <div className="mb-3 p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-sm">
          {err}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-700">
        <table className="min-w-full border-collapse">
          <thead className="bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left">Card</th>
              <th className="px-3 py-2 text-left">Set</th>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Rarity</th>
              <th className="px-3 py-2 text-right">EUR</th>
              <th className="px-3 py-2 text-right">TIX</th>
              <th className="px-3 py-2 text-right">EDH</th>
              <th className="px-3 py-2 text-right">Class</th>
            </tr>
          </thead>

          <tbody>
  {sorted.map((r, idx) => {
    const rowTint =
      r.stockClass === "CORE"
        ? "ring-1 ring-yellow-500/20 bg-yellow-500/5"
        : r.stockClass === "CTBULK"
        ? "ring-1 ring-orange-500/20 bg-orange-500/5"
        : "";

    return (
      <tr
        key={r.scryfallId}
        className={
          (idx % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/40") +
          (rowTint ? " " + rowTint : "")
        }
      >
                <td className="px-3 py-2">
                  <div className="font-medium flex items-center gap-2">
  {r.stockClass === "CORE" && (
    <span className="text-yellow-300" title="CORE">
      ★
    </span>
  )}
  {r.stockClass === "CTBULK" && (
    <span className="text-orange-300" title="CTBULK">
      ●
    </span>
  )}
  <span>{r.name}</span>
</div>

                  <div className="text-[11px] opacity-60 font-mono">
                    cm:{r.cardmarketId} · {r.scryfallId.slice(0, 8)}…
                    {r.gameChanger ? " · GC" : ""}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono">{r.set.toUpperCase()}</td>
                <td className="px-3 py-2 font-mono">{r.collectorNumber ?? "-"}</td>
                <td className="px-3 py-2">{r.rarity ?? "-"}</td>
                <td className="px-3 py-2 text-right">
                  {r.eur != null ? r.eur.toFixed(2) : "-"}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.tix != null ? r.tix.toFixed(2) : "-"}
                </td>
                <td className="px-3 py-2 text-right">{r.edhrecRank ?? "-"}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2 justify-end">
                    <ClassButton row={r} label="★ CORE" value="CORE" />
                    <ClassButton row={r} label="REG" value="REGULAR" />
                    <ClassButton row={r} label="CTB" value="CTBULK" />
                  </div>
                </td>
              </tr>
             );
  })}
</tbody>
        </table>

        {rows.length > 0 && sorted.length === 0 && (
          <div className="p-4 opacity-70">Geen resultaten (filter).</div>
        )}

        {rows.length === 0 && (
          <div className="p-4 opacity-70">Geen kaarten gevonden voor deze set.</div>
        )}
      </div>
    </div>
  );
}
