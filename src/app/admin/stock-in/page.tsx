"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PickRow = {
  location: string;
  set: string;
  name: string;
  collectorNumber: string | null;
  condition: string;
  language: string;
  isFoil: boolean;
  qty: number;
  cardmarketId: number;
  sourceCode: string;
  sourceDate: string; // ISO
  unitCostEur: number;
};

type UploadResult = {
  ok: boolean;
  rowsParsed?: number;
  rowsConsolidated?: number;
  lotsCreated?: number;
  balancesUpserted?: number;
  rowErrors?: { line: number; message: string }[];
  warnings?: any[]; // laat even any zodat je huidige warnings vorm niet breekt
  picklist?: PickRow[];
  error?: string;
};

export default function StockInPage() {
  const [csvText, setCsvText] = useState("");
  const [defaultSourceCode, setDefaultSourceCode] = useState("");
  const [defaultSourceDate, setDefaultSourceDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(file);
  }

  async function handleUpload() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/stock-in/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: csvText,
          defaultSourceCode: defaultSourceCode || null,
          defaultSourceDate: defaultSourceDate || null,
        }),
      });

      const body = (await res.json()) as UploadResult;

      if (!res.ok) {
        setError(body.error || `Upload failed (${res.status})`);
      } else if (!body.ok) {
        setError(body.error || "Upload completed with issues");
      }

      setResult(body);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  const hasRowErrors = (result?.rowErrors?.length ?? 0) > 0;
  const hasWarnings = (result?.warnings?.length ?? 0) > 0;

  const picklist = useMemo(() => {
    return (result?.picklist ?? []).filter((r) => r && r.location);
  }, [result]);

  function downloadPicklistCsv() {
    const rows = picklist;
    if (!rows.length) return;

    const header = [
      "location",
      "set",
      "name",
      "collectorNumber",
      "condition",
      "language",
      "isFoil",
      "qty",
      "cardmarketId",
      "sourceCode",
      "sourceDate",
      "unitCostEur",
    ];

    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const csv =
      header.join(",") +
      "\n" +
      rows
        .map((r) =>
          [
            r.location,
            r.set,
            r.name,
            r.collectorNumber ?? "",
            r.condition,
            r.language,
            r.isFoil ? "1" : "0",
            r.qty,
            r.cardmarketId,
            r.sourceCode,
            r.sourceDate,
            r.unitCostEur,
          ]
            .map(esc)
            .join(",")
        )
        .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stockin-picklist-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Stock-in CSV upload</h1>

      <div className="space-y-2 text-sm">
        <p>Verwacht CSV-header (komma of puntkomma):</p>
        <pre className="bg-black/40 p-2 rounded text-xs overflow-x-auto">
          cardmarketId,isFoil,condition,qty,unitCostEur,sourceCode,sourceDate,language
        </pre>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">CSV-bestand</label>
          <Input type="file" accept=".csv,text/csv" onChange={handleFile} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Default source code</label>
          <Input
            value={defaultSourceCode}
            onChange={(e) => setDefaultSourceCode(e.target.value)}
            placeholder="bijv. FIC210925"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Default source date (YYYY-MM-DD of DD-MM-YYYY)
          </label>
          <Input
            value={defaultSourceDate}
            onChange={(e) => setDefaultSourceDate(e.target.value)}
            placeholder="06-01-2026"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">CSV inhoud (optioneel bekijken/bijwerken)</label>
        <textarea
          className="min-h-[160px] w-full rounded-md border px-3 py-2 bg-black/20 font-mono text-xs"
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
        />
      </div>

      <Button onClick={handleUpload} disabled={loading || !csvText} className="min-w-[180px]">
        {loading ? "Uploaden…" : "Stock-in verwerken"}
      </Button>

      {error && (
        <pre className="bg-red-950/40 text-red-300 p-3 rounded text-xs whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div
            className={`rounded-md border p-3 text-sm ${
              result.ok
                ? "border-emerald-700/50 bg-emerald-950/20"
                : "border-amber-700/50 bg-amber-950/20"
            }`}
          >
            <div className="font-medium">Result: {result.ok ? "OK" : "Completed with issues"}</div>
            <div className="opacity-90">
              rowsParsed: {result.rowsParsed ?? 0} · lotsCreated: {result.lotsCreated ?? 0} ·
              balancesUpserted: {result.balancesUpserted ?? 0}
              {typeof result.rowsConsolidated === "number"
                ? ` · rowsConsolidated: ${result.rowsConsolidated}`
                : ""}
            </div>
            {picklist.length > 0 && <div className="opacity-90 mt-1">picklist rows: {picklist.length}</div>}
          </div>

          {/* Picklist table */}
          {picklist.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm opacity-80">
                  Picklist (gesorteerd): location → set → name → condition
                </div>
                <Button variant="secondary" onClick={downloadPicklistCsv}>
                  Download picklist CSV
                </Button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/10">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/30">
                    <tr>
                      <th className="text-left p-2">location</th>
                      <th className="text-left p-2">set</th>
                      <th className="text-left p-2">name</th>
                      <th className="text-left p-2">#</th>
                      <th className="text-left p-2">cond</th>
                      <th className="text-left p-2">lang</th>
                      <th className="text-left p-2">foil</th>
                      <th className="text-right p-2">qty</th>
                      <th className="text-left p-2">cmid</th>
                      <th className="text-left p-2">source</th>
                      <th className="text-left p-2">date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {picklist.map((r, i) => (
                      <tr key={i} className="odd:bg-black/10">
                        <td className="p-2 font-mono">{r.location}</td>
                        <td className="p-2 font-mono">{r.set || "—"}</td>
                        <td className="p-2">{r.name || "—"}</td>
                        <td className="p-2 font-mono">{r.collectorNumber ?? "—"}</td>
                        <td className="p-2 font-mono">{r.condition}</td>
                        <td className="p-2 font-mono">{r.language}</td>
                        <td className="p-2">{r.isFoil ? "FOIL" : ""}</td>
                        <td className="p-2 text-right font-mono">{r.qty}</td>
                        <td className="p-2 font-mono">{r.cardmarketId}</td>
                        <td className="p-2 font-mono">{r.sourceCode}</td>
                        <td className="p-2 font-mono">{String(r.sourceDate).slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-xs opacity-70">
                Tip: dit is exact je “neerleg-lijst” voor deze upload. Download als CSV en sorteer/filter in Excel indien nodig.
              </div>
            </div>
          )}

          {/* Warnings */}
          {hasWarnings && (
            <div className="rounded-md border border-yellow-700/50 bg-yellow-950/20 p-3">
              <div className="text-yellow-200 font-medium text-sm mb-2">
                Warnings ({result.warnings!.length})
              </div>
              <ul className="text-yellow-100/90 text-xs space-y-1">
                {result.warnings!.slice(0, 200).map((w: any, i: number) => (
                  <li key={i}>
                    {typeof w === "string" ? (
                      w
                    ) : (
                      <>
                        <span className="opacity-80">line {w.line}:</span> {w.message}
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {result.warnings!.length > 200 && (
                <div className="text-yellow-100/70 text-xs mt-2">
                  (ingekort — {result.warnings!.length - 200} meer)
                </div>
              )}
            </div>
          )}

          {/* Row errors */}
          {hasRowErrors && (
            <div className="rounded-md border border-red-700/50 bg-red-950/20 p-3">
              <div className="text-red-200 font-medium text-sm mb-2">
                Errors ({result.rowErrors!.length})
              </div>
              <ul className="text-red-100/90 text-xs space-y-1">
                {result.rowErrors!.slice(0, 200).map((w, i) => (
                  <li key={i}>
                    <span className="opacity-80">line {w.line}:</span> {w.message}
                  </li>
                ))}
              </ul>
              {result.rowErrors!.length > 200 && (
                <div className="text-red-100/70 text-xs mt-2">
                  (ingekort — {result.rowErrors!.length - 200} meer)
                </div>
              )}
            </div>
          )}

          {/* Raw JSON */}
          <details className="rounded-md border border-zinc-700/50 bg-black/20 p-3">
            <summary className="cursor-pointer text-sm opacity-90">Toon raw JSON</summary>
            <pre className="mt-3 text-xs whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
