"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Row = {
  id: number;
  ctOrderId: number;
  state: string;
  paidAt: string | null;
  sentAt: string | null;
  sellerTotalEur: number | null;
  createdAtDb: string;
  lineCount: number;
  missingLocCount: number;
};

type Api = { ok: boolean; items?: Row[]; error?: string };

const inputClass =
  "!text-white !placeholder:text-zinc-500 !bg-zinc-900/60 !border-zinc-700 focus:!ring-1 focus:!ring-zinc-500 caret-white selection:bg-white/20";

export default function CtPickOrdersPage() {
  const [stateFilter, setStateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);

  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (stateFilter.trim()) params.set("state", stateFilter.trim());
      params.set("limit", String(limit));

      const res = await fetch(`/api/admin/ct/orders?${params.toString()}`, { cache: "no-store" });
      const body: Api = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || "Load failed");
      setData(body.items || []);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) => String(r.ctOrderId).includes(q) || r.state.toLowerCase().includes(q));
  }, [data, search]);

  return (
    <div className="p-6 space-y-6 text-zinc-100">
      <h1 className="text-2xl font-semibold">CT pick — orders</h1>

      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-sm text-zinc-200">State (optioneel)</label>
          <Input
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            placeholder="Bijv. paid / shipped / ..."
            className={`w-48 ${inputClass}`}
            style={{ color: "#fff" }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-zinc-200">Zoek</label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="OrderId of state..."
            className={`w-48 ${inputClass}`}
            style={{ color: "#fff" }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-zinc-200">Limit</label>
          <Input
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value || "50"))}
            className={`w-24 ${inputClass}`}
            style={{ color: "#fff" }}
          />
        </div>

        <Button onClick={load} disabled={loading} className="mt-6 whitespace-nowrap">
          {loading ? "Laden..." : "Verversen"}
        </Button>

        {loading && <div className="mt-7 text-xs text-zinc-400">Laden…</div>}
      </div>

      {err && <div className="text-sm text-red-400">{err}</div>}

      <table className="w-full text-sm">
        <thead className="bg-black/30">
          <tr>
            <th className="p-2 text-left">Order</th>
            <th className="p-2 text-left">State</th>
            <th className="p-2 text-left">Created</th>
            <th className="p-2 text-left">Paid</th>
            <th className="p-2 text-left">Sent</th>
            <th className="p-2 text-right">Lines</th>
            <th className="p-2 text-right">Missing loc</th>
            <th className="p-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length ? (
            filtered.map((r) => (
              <tr key={r.id} className="odd:bg-black/10">
                <td className="p-2">
                  <Link
                    href={`/admin/pick/ct/${r.ctOrderId}`}
                    className="underline underline-offset-2 hover:text-white"
                  >
                    CT #{r.ctOrderId}
                  </Link>
                </td>
                <td className="p-2">{r.state}</td>
                <td className="p-2 text-xs text-zinc-300">
                  {new Date(r.createdAtDb).toLocaleString("nl-NL")}
                </td>
                <td className="p-2 text-xs text-zinc-300">
                  {r.paidAt ? new Date(r.paidAt).toLocaleString("nl-NL") : "-"}
                </td>
                <td className="p-2 text-xs text-zinc-300">
                  {r.sentAt ? new Date(r.sentAt).toLocaleString("nl-NL") : "-"}
                </td>
                <td className="p-2 text-right">{r.lineCount}</td>
                <td className={`p-2 text-right ${r.missingLocCount > 0 ? "text-amber-300" : ""}`}>
                  {r.missingLocCount}
                </td>
                <td className="p-2 text-right">{r.sellerTotalEur != null ? r.sellerTotalEur.toFixed(2) : "-"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="p-3 text-center text-zinc-400">
                Geen orders.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
