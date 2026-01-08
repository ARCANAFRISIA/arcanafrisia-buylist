"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type UploadResult = {
  ok: boolean;
  rowsParsed?: number;
  lotsCreated?: number;
  balancesUpserted?: number;
  rowErrors?: { line: number; message: string }[];
  warnings?: { line: number; message: string }[];
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
    reader.onload = () => {
      setCsvText(String(reader.result || ""));
    };
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
        // ok==false maar wel 200 -> behandel als "validatie errors"
        setError(body.error || "Upload completed with errors");
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
          <label className="text-sm font-medium">Default source date (YYYY-MM-DD of DD-MM-YYYY)</label>
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
              result.ok ? "border-emerald-700/50 bg-emerald-950/20" : "border-amber-700/50 bg-amber-950/20"
            }`}
          >
            <div className="font-medium">
              Result: {result.ok ? "OK" : "Completed with issues"}
            </div>
            <div className="opacity-90">
              rowsParsed: {result.rowsParsed ?? 0} · lotsCreated: {result.lotsCreated ?? 0} · balancesUpserted:{" "}
              {result.balancesUpserted ?? 0}
            </div>
          </div>

          {/* Warnings */}
          {hasWarnings && (
            <div className="rounded-md border border-yellow-700/50 bg-yellow-950/20 p-3">
              <div className="text-yellow-200 font-medium text-sm mb-2">
                Warnings ({result.warnings!.length})
              </div>
              <ul className="text-yellow-100/90 text-xs space-y-1">
                {result.warnings!.slice(0, 200).map((w, i) => (
                  <li key={i}>
                    <span className="opacity-80">line {w.line}:</span> {w.message}
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

          {/* Raw JSON (handig) */}
          <details className="rounded-md border border-zinc-700/50 bg-black/20 p-3">
            <summary className="cursor-pointer text-sm opacity-90">Toon raw JSON</summary>
            <pre className="mt-3 text-xs whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
