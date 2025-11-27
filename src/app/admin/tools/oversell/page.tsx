"use client";

import { useEffect, useState } from "react";

type OversellRow = {
  cardmarketId: number;
  name: string;
  isFoil: boolean;
  condition: string;
  language: string;
  total_in: number;
  total_remaining: number;
  total_sold_applied: number;
  balance_qty: number;
  theoretical_on_hand: number;
  diff_qty: number;
};

type ApiResponse = {
  ok: boolean;
  count: number;
  rows: OversellRow[];
  error?: string;
};

export default function OversellPage() {
  const [rows, setRows] = useState<OversellRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchData() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/tools/oversell", {
        cache: "no-store",
      });
      const data: ApiResponse = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRows(data.rows);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Oversell diagnostics</h1>
          <p className="text-sm text-muted-foreground">
            SKUs waar lots + applied sales niet netjes overeenkomen met InventoryBalance.
          </p>
        </div>
        <button
          className="rounded border px-3 py-1 text-sm"
          onClick={fetchData}
          disabled={loading}
        >
          {loading ? "Laden..." : "Ververs"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="max-h-[70vh] overflow-auto rounded border">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-muted whitespace-nowrap">
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-2 py-1 text-left">CMID</th>
              <th className="px-2 py-1 text-left">Naam</th>
              <th className="px-2 py-1 text-left">Lang</th>
              <th className="px-2 py-1 text-left">Cond</th>
              <th className="px-2 py-1 text-left">Foil</th>
              <th className="px-2 py-1 text-right">In</th>
              <th className="px-2 py-1 text-right">Remaining lots</th>
              <th className="px-2 py-1 text-right">Sold (applied)</th>
              <th className="px-2 py-1 text-right">Balance qty</th>
              <th className="px-2 py-1 text-right">Theoretical</th>
              <th className="px-2 py-1 text-right">Diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.cardmarketId}-${r.language}-${r.condition}-${r.isFoil ? "F" : "N"}`}
                className={
                  "border-t hover:bg-muted/40 " +
                  (r.theoretical_on_hand < 0 || r.balance_qty < 0
                    ? "bg-red-100"
                    : r.diff_qty !== 0
                    ? "bg-yellow-100"
                    : "")
                }
              >
                <td className="px-2 py-1">{r.cardmarketId}</td>
                <td className="px-2 py-1 max-w-[220px] truncate">
                  {r.name}
                </td>
                <td className="px-2 py-1">{r.language}</td>
                <td className="px-2 py-1">{r.condition}</td>
                <td className="px-2 py-1">{r.isFoil ? "✓" : ""}</td>
                <td className="px-2 py-1 text-right">{r.total_in}</td>
                <td className="px-2 py-1 text-right">{r.total_remaining}</td>
                <td className="px-2 py-1 text-right">
                  {r.total_sold_applied}
                </td>
                <td className="px-2 py-1 text-right">{r.balance_qty}</td>
                <td className="px-2 py-1 text-right">
                  {r.theoretical_on_hand}
                </td>
                <td className="px-2 py-1 text-right">{r.diff_qty}</td>
              </tr>
            ))}

            {rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={11}
                  className="px-2 py-3 text-center text-xs text-muted-foreground"
                >
                  Geen afwijkingen gevonden. 🎉
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
