"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Summary = {
  totalSkus: number;
  tooMuch: number;
  tooLittle: number;
  stockMismatch: number;
};

type ApiResponse = {
  ok: boolean;
  summary?: Summary;
  csv?: {
    tooMuchCsv: string;
    tooLittleCsv: string;
    stockMismatchCsv: string;
  };
  error?: string;
};

export default function CmStockAuditPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [csv, setCsv] = useState<ApiResponse["csv"] | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Kies eerst een CSV-bestand.");
      return;
    }

    setLoading(true);
    setError(null);
    setSummary(null);
    setCsv(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/tools/cm-stock-audit", {
        method: "POST",
        body: formData,
      });

      const data: ApiResponse = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setSummary(data.summary ?? null);
      setCsv(data.csv ?? null);
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Onbekende fout");
    } finally {
      setLoading(false);
    }
  };

  const triggerDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-8">
      <h1 className="text-2xl font-semibold">Cardmarket stock audit</h1>

      <p className="text-sm text-muted-foreground">
        Upload hier je Cardmarket stock export (CSV met o.a.{" "}
        <code>idProduct</code>, <code>Count</code>, <code>Language</code>,{" "}
        <code>Condition</code>). De tool vergelijkt dit met je
        InventoryBalance + ListPolicy en maakt drie CSV&apos;s:
        &nbsp;&quot;te veel&quot;, &quot;te weinig&quot; en
        &quot;stock mismatch&quot;.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Cardmarket stock CSV
          </label>
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
            }}
          />
          {file && (
            <p className="text-xs text-muted-foreground">
              Gekozen bestand: {file.name}
            </p>
          )}
        </div>

        <Button type="submit" disabled={loading || !file}>
          {loading ? "Bezig met audit..." : "Audit draaien"}
        </Button>
      </form>

      {error && (
        <p className="text-sm text-red-600">
          {error}
        </p>
      )}

      {summary && (
        <div className="space-y-2 border rounded-lg p-4">
          <h2 className="font-medium">Resultaat</h2>
          <ul className="text-sm">
            <li>Totaal SKU&apos;s: {summary.totalSkus}</li>
            <li>Te veel op CM: {summary.tooMuch}</li>
            <li>Te weinig op CM: {summary.tooLittle}</li>
            <li>Stock mismatch (CM vs onHand): {summary.stockMismatch}</li>
          </ul>
        </div>
      )}

      {csv && (
        <div className="space-y-2 border rounded-lg p-4">
          <h2 className="font-medium">Downloads</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!csv.tooMuchCsv}
              onClick={() =>
                csv.tooMuchCsv &&
                triggerDownload(csv.tooMuchCsv, "cm-stock-too-much.csv")
              }
            >
              Te veel op CM
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!csv.tooLittleCsv}
              onClick={() =>
                csv.tooLittleCsv &&
                triggerDownload(csv.tooLittleCsv, "cm-stock-too-little.csv")
              }
            >
              Te weinig op CM
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!csv.stockMismatchCsv}
              onClick={() =>
                csv.stockMismatchCsv &&
                triggerDownload(
                  csv.stockMismatchCsv,
                  "cm-stock-mismatch.csv"
                )
              }
            >
              Stock mismatch
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
