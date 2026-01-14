"use client";

import { use as usePromise, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Order = {
  ctOrderId: number;
  state: string;
  paidAt: string | null;
  sentAt: string | null;
  sellerTotalEur: number | null;
  shippingEur: number | null;
};

type Line = {
  id: number;
  ctLineId: number;
  resolvedCardmarketId: number | null;

  name: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;

  isFoil: boolean;
  condition: string | null;
  language: string | null;
  quantity: number;

  unitPriceEur: number | null;
  lineGrossEur: number | null;

  commentRaw: string | null;
  saleslogComment: string | null;

  locFromComment: string | null;
  locFromInventory: string | null;
  location: string | null;
};

type Api = { ok: boolean; order?: Order; lines?: Line[]; error?: string };

const inputClass =
  "!text-white !placeholder:text-zinc-500 !bg-zinc-900/60 !border-zinc-700 focus:!ring-1 focus:!ring-zinc-500 caret-white selection:bg-white/20";

// Multi-sort keys (CT-style)
type SortKey = "none" | "location" | "set" | "name" | "condition" | "comment";

function cmp(a: any, b: any) {
  const A = (a ?? "").toString().toUpperCase();
  const B = (b ?? "").toString().toUpperCase();
  if (A < B) return -1;
  if (A > B) return 1;
  return 0;
}

function sortValue(l: Line, key: SortKey) {
  switch (key) {
    case "location":
      return l.location ?? "";
    case "set":
      return l.setCode ?? "";
    case "name":
      return l.name ?? "";
    case "condition":
      return l.condition ?? "";
    case "comment":
      return l.saleslogComment ?? l.commentRaw ?? "";
    case "none":
    default:
      return "";
  }
}

function pickedStorageKey(ctOrderId: number) {
  return `ct_pick_${ctOrderId}`;
}

export default function CtPickOrderPage({
  params,
}: {
  params: Promise<{ ctOrderId: string }>;
}) {
  const { ctOrderId: ctOrderIdStr } = usePromise(params);
  const ctOrderId = Number(ctOrderIdStr);

  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  // ✅ Multi-level sort (zoals CT / Excel)
  const [sort1, setSort1] = useState<SortKey>("location");
  const [sort2, setSort2] = useState<SortKey>("set");
  const [sort3, setSort3] = useState<SortKey>("name");
  const [sort4, setSort4] = useState<SortKey>("condition");
  const [missingFirst, setMissingFirst] = useState(true);

  // picked state (local only)
  const [picked, setPicked] = useState<Record<number, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(pickedStorageKey(ctOrderId));
      if (raw) setPicked(JSON.parse(raw));
    } catch {}
  }, [ctOrderId]);

  useEffect(() => {
    try {
      localStorage.setItem(pickedStorageKey(ctOrderId), JSON.stringify(picked));
    } catch {}
  }, [picked, ctOrderId]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/ct/orders/${ctOrderId}`, { cache: "no-store" });
      const body: Api = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || "Load failed");
      setOrder(body.order || null);
      setLines(body.lines || []);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctOrderId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => {
      const hay = [
        l.name,
        l.setCode,
        l.collectorNumber,
        l.location,
        l.condition,
        l.language,
        l.resolvedCardmarketId != null ? String(l.resolvedCardmarketId) : "",
        l.saleslogComment,
        l.commentRaw,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [lines, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];

    const keys: SortKey[] = [sort1, sort2, sort3, sort4].filter((k) => k !== "none");

    arr.sort((a, b) => {
      // 0) Missing first (optioneel)
      if (missingFirst) {
        const am = a.location ? 0 : 1;
        const bm = b.location ? 0 : 1;
        if (am !== bm) return bm - am; // missing first
      }

      // 1..4) Multi-level sort
      for (const k of keys) {
        const c = cmp(sortValue(a, k), sortValue(b, k));
        if (c !== 0) return c;
      }

      // fallback stabiel
      return a.id - b.id;
    });

    return arr;
  }, [filtered, sort1, sort2, sort3, sort4, missingFirst]);

  const missingCount = useMemo(() => sorted.filter((l) => !l.location).length, [sorted]);

  const pickedCount = useMemo(() => {
    return sorted.reduce((acc, l) => acc + (picked[l.id] ? 1 : 0), 0);
  }, [sorted, picked]);

  function togglePicked(lineId: number) {
    setPicked((prev) => ({ ...prev, [lineId]: !prev[lineId] }));
  }

  // ✅ toggle: als alles zichtbaar picked is -> unpick visible, anders pick visible
  function markAllVisiblePicked() {
    const allPicked = sorted.length > 0 && sorted.every((l) => !!picked[l.id]);

    if (allPicked) {
      const next: Record<number, boolean> = { ...picked };
      for (const l of sorted) delete next[l.id];
      setPicked(next);
    } else {
      const next: Record<number, boolean> = { ...picked };
      for (const l of sorted) next[l.id] = true;
      setPicked(next);
    }
  }

  function clearAllPicked() {
    setPicked({});
  }

  const allVisiblePicked = sorted.length > 0 && sorted.every((l) => !!picked[l.id]);

  return (
    <div className="p-6 space-y-6 text-zinc-100">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm text-zinc-400">
            <Link href="/admin/pick/ct" className="underline underline-offset-2">
              ← Terug
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">CT pick — #{ctOrderId}</h1>
          {order && (
            <div className="text-sm text-zinc-300">
              State: <span className="text-zinc-100">{order.state}</span>{" "}
              · Paid: {order.paidAt ? new Date(order.paidAt).toLocaleString("nl-NL") : "-"}{" "}
              · Sent: {order.sentAt ? new Date(order.sentAt).toLocaleString("nl-NL") : "-"}{" "}
              · Total: {order.sellerTotalEur != null ? order.sellerTotalEur.toFixed(2) : "-"}{" "}
              · Missing loc:{" "}
              <span className={missingCount ? "text-amber-300" : ""}>{missingCount}</span>
              {" · "}
              Picked: {pickedCount}/{sorted.length}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? "Laden..." : "Verversen"}
          </Button>
        </div>
      </div>

      {err && <div className="text-sm text-red-400">{err}</div>}

      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-sm text-zinc-200">Zoek in order</label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Naam, set, loc, cm id..."
            className={`w-64 ${inputClass}`}
            style={{ color: "#fff" }}
          />
        </div>

        {/* ✅ 4-level sort zoals CT */}
        <div className="flex flex-col gap-2">
          <label className="text-sm text-zinc-200">Sort (1 → 4)</label>
          <div className="flex flex-wrap gap-2 items-center">
            {[
              [sort1, setSort1],
              [sort2, setSort2],
              [sort3, setSort3],
              [sort4, setSort4],
            ].map(([val, setter], idx) => (
              <select
                key={idx}
                value={val as SortKey}
                onChange={(e) => (setter as any)(e.target.value as SortKey)}
                className="h-10 rounded-md border border-zinc-700 bg-zinc-900/60 px-3 text-sm text-white"
              >
                <option value="none">No grouping</option>
                <option value="location">Location</option>
                <option value="set">Set Alphabetically</option>
                <option value="name">Item Name Alphabetically</option>
                <option value="condition">Condition</option>
                <option value="comment">Comment</option>
              </select>
            ))}

            <label className="flex items-center gap-2 text-sm text-zinc-200 ml-2">
              <input
                type="checkbox"
                checked={missingFirst}
                onChange={(e) => setMissingFirst(e.target.checked)}
              />
              Missing location eerst
            </label>
          </div>
        </div>

        <Button onClick={markAllVisiblePicked} className="mt-6">
          {allVisiblePicked ? "Maak zichtbaar unpicked" : "Markeer zichtbaar als picked"}
        </Button>

        <Button onClick={clearAllPicked} variant="outline" className="mt-6">
          Reset picked
        </Button>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-black/30">
          <tr>
            <th className="p-2 text-left">Pick</th>
            <th className="p-2 text-left">Card</th>
            <th className="p-2 text-left">Set</th>
            <th className="p-2 text-left">#</th>
            <th className="p-2 text-left">Foil</th>
            <th className="p-2 text-left">Cond</th>
            <th className="p-2 text-left">Lang</th>
            <th className="p-2 text-right">Qty</th>
            <th className="p-2 text-left">Loc</th>
            <th className="p-2 text-right">Unit</th>
            <th className="p-2 text-right">Line</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length ? (
            sorted.map((l) => {
              const isMissing = !l.location;
              const isPicked = !!picked[l.id];

              return (
                <tr
                  key={l.id}
                  className={[
                    "odd:bg-black/10 align-middle",
                    isMissing ? "bg-amber-500/10" : "",
                    isPicked ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={isPicked}
                      onChange={() => togglePicked(l.id)}
                      className="h-4 w-4"
                      title="Picked"
                    />
                  </td>

                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {l.imageUrl && (
                        <img
                          src={l.imageUrl}
                          alt={l.name ?? "card"}
                          className="w-12 h-16 object-cover rounded border border-zinc-800"
                        />
                      )}
                      <div>
                        <div className="font-medium text-sm">{l.name ?? "—"}</div>
                        <div className="text-xs text-zinc-400">
                          CM: {l.resolvedCardmarketId ?? "-"} · CT line: {l.ctLineId}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="p-2">{l.setCode ?? "-"}</td>
                  <td className="p-2">{l.collectorNumber ?? "-"}</td>
                  <td className="p-2">{l.isFoil ? "Foil" : "-"}</td>
                  <td className="p-2">{l.condition ?? "-"}</td>
                  <td className="p-2">{l.language ?? "-"}</td>
                  <td className="p-2 text-right">{l.quantity}</td>

                  <td className="p-2">
                    <div className="text-xs">
                      <div className={isMissing ? "text-amber-300 font-semibold" : "text-zinc-100"}>
                        {l.location ?? "MISSING"}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {l.locFromComment ? "comment" : l.locFromInventory ? "inventory" : "-"}
                      </div>
                    </div>
                  </td>

                  <td className="p-2 text-right">
                    {l.unitPriceEur != null ? l.unitPriceEur.toFixed(2) : "-"}
                  </td>
                  <td className="p-2 text-right">
                    {l.lineGrossEur != null ? l.lineGrossEur.toFixed(2) : "-"}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={11} className="p-3 text-center text-zinc-400">
                Geen lines.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="text-xs text-zinc-400">
        Highlight: amber = missing location (geen match in SalesLog/CT comment en geen InventoryLot fallback).
      </div>
    </div>
  );
}
