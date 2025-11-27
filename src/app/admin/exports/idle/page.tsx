"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type IdleExportRow = {
  cardmarketId: number;
  name: string | null;
  isFoil: boolean;
  condition: string;
  languageCode: string;
  languageCmId: number | null;
  qty: number;
  oldPrice: number;
  newPrice: number;
  discountPct: number;
  idleDays: number;
  cmLowEx: number | null;
  cmGermanProLow: number | null;
  ctMin: number | null;
  floorReason: string | null;
};

type IdleExportResponse = {
  ok: boolean;
  bfMode: boolean;
  minIdleDays: number;
  floorRatio: number;
  minPrice: number;
  count: number;
  rows: IdleExportRow[];
};

export default function IdleExportPage() {
  const [rows, setRows] = useState<IdleExportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bfMode, setBfMode] = useState(true); // default: BF aan (25%)
  const [minDays, setMinDays] = useState(14);
  const [meta, setMeta] = useState<{
    floorRatio: number;
    minPrice: number;
    count: number;
  } | null>(null);

  async function fetchData() {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set("bf", bfMode ? "1" : "0");
      params.set("minDays", String(minDays));
      params.set("format", "json");

      const res = await fetch(`/api/export/idle?${params.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data: IdleExportResponse = await res.json();

      if (!data.ok) {
        throw new Error(data as any);
      }

      setRows(data.rows);
      setMeta({
        floorRatio: data.floorRatio,
        minPrice: data.minPrice,
        count: data.count,
      });
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // eerste load

  function handleReload() {
    fetchData();
  }

  function handleDownloadCsv() {
    const params = new URLSearchParams();
    params.set("bf", bfMode ? "1" : "0");
    params.set("minDays", String(minDays));
    params.set("format", "csv");

    window.location.href = `/api/export/idle?${params.toString()}`;
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Idle Export</h1>
          <p className="text-sm text-muted-foreground">
            Overzicht van idle voorraad op basis van InventoryBalance &amp; CM/CT prijzen.
          </p>
          {meta && (
            <p className="mt-1 text-xs text-muted-foreground">
              {meta.count} SKU&apos;s • floor: {Math.round(meta.floorRatio * 100)}% van markt • min prijs €{" "}
              {meta.minPrice.toFixed(2)}
            </p>
          )}
        </div>

        <div className="flex flex-col items-start gap-3 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <input
              id="bfMode"
              type="checkbox"
              className="h-4 w-4"
              checked={bfMode}
              onChange={(e) => setBfMode(e.target.checked)}
            />
            <label htmlFor="bfMode" className="text-sm">
              Black Friday mode (25% i.p.v. 20%)
            </label>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="minDays" className="text-sm">
              Min. idle dagen
            </label>
            <input
              id="minDays"
              type="number"
              min={1}
              className="w-20 rounded border px-2 py-1 text-sm"
              value={minDays}
              onChange={(e) => setMinDays(Number(e.target.value) || 0)}
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReload}
              disabled={loading}
            >
              {loading ? "Laden..." : "Ververs"}
            </Button>
            <Button
              size="sm"
              onClick={handleDownloadCsv}
              disabled={loading || rows.length === 0}
            >
              Download CSV
            </Button>
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Fout bij ophalen idle export: {error}
        </div>
      )}

      <div className="rounded-md border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
          <span>
            Resultaten: {rows.length}{" "}
            {loading && <span className="ml-2 italic">– laden...</span>}
          </span>
          <span>
            Kolommen: CMID • lang • cond • foil • qty • oude prijs • nieuwe prijs • %
            korting • idle dagen • CM lowEx • CT min • floors
          </span>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-muted whitespace-nowrap">
  <tr className="border-b text-xs text-muted-foreground">
    <th className="px-2 py-1 text-left">CMID</th>
    <th className="px-2 py-1 text-left">Naam</th>

    <th className="px-2 py-1 text-left">Lang</th>
    <th className="px-2 py-1 text-left">Cond</th>
    <th className="px-2 py-1 text-left">Foil</th>

    <th className="px-2 py-1 text-right">Qty</th>

    <th className="px-2 py-1 text-right">Oud</th>
    <th className="px-2 py-1 text-right">Nieuw</th>
    <th className="px-2 py-1 text-right">%</th>

    <th className="px-2 py-1 text-right">Idle</th>

    <th className="px-2 py-1 text-right">CM lowEx</th>
    <th className="px-2 py-1 text-right">CT min</th>

    <th className="px-2 py-1 text-left">Floor</th>
  </tr>
</thead>

            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.cardmarketId}-${row.languageCode}-${row.condition}-${row.isFoil ? "F" : "N"}`}
                  className="border-t hover:bg-muted/40"
                >
                  <td className="px-2 py-1">{row.cardmarketId}</td>
                  <td className="px-2 py-1 truncate max-w-[180px]">
                    {row.name ?? `CM#${row.cardmarketId}`}
                  </td>
                  <td className="px-2 py-1">{row.languageCode}</td>
                  <td className="px-2 py-1">{row.condition}</td>
                  <td className="px-2 py-1">{row.isFoil ? "✓" : ""}</td>
                  <td className="px-2 py-1 text-right">{row.qty}</td>
                  <td className="px-2 py-1 text-right">
                    € {row.oldPrice.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    € {row.newPrice.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {(row.discountPct * 100).toFixed(1)}%
                  </td>
                  <td className="px-2 py-1 text-right">{row.idleDays}</td>
                  <td className="px-2 py-1 text-right">
                    {row.cmLowEx != null ? `€ ${row.cmLowEx.toFixed(2)}` : "–"}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {row.ctMin != null ? `€ ${row.ctMin.toFixed(2)}` : "–"}
                  </td>
                  <td className="px-2 py-1">
                    {row.floorReason ?? ""}
                  </td>
                </tr>
              ))}

              {rows.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={13}
                    className="px-2 py-4 text-center text-xs text-muted-foreground"
                  >
                    Geen idle items gevonden met deze filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
