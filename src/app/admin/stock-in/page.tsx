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
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    csv: csvText,
    defaultSourceCode: defaultSourceCode || null,
    defaultSourceDate: defaultSourceDate || null,
  }),
});

      const body = (await res.json()) as UploadResult;
      if (!res.ok || !body.ok) {
        setError(body.error || `Upload failed (${res.status})`);
      }
      setResult(body);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Stock-in CSV upload</h1>

      <div className="space-y-2 text-sm">
        <p>Verwacht CSV-header (komma of puntkomma):</p>
        <pre className="bg-black/40 p-2 rounded text-xs">
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
          <label className="text-sm font-medium">Default source date (YYYY-MM-DD)</label>
          <Input
            value={defaultSourceDate}
            onChange={(e) => setDefaultSourceDate(e.target.value)}
            placeholder="2025-11-14"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">
  CSV inhoud (optioneel bekijken/bijwerken)
</label>
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
        <pre className="bg-black/40 p-3 rounded text-xs whitespace-pre-wrap">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
