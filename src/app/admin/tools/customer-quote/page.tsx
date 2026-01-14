"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Result = {
  ok: boolean;
  error?: string;
  defaultCond?: string;
  counts?: any;
  totals?: any;
  buying?: any[];
  notBuying?: any[];
  notFound?: any[];
};

function toCsv(rows: any[], cols: string[]) {
  const esc = (v: any) => {
    const s = (v ?? "").toString();
    if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = cols.join(";");
  const lines = rows.map(r => cols.map(c => esc(r?.[c])).join(";"));
  return [header, ...lines].join("\n");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function CustomerQuotePage() {
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null);
    setResult(null);
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setCsvText(text);
  }

  async function run() {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/tools/customer-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText, defaultCond: "NM" }),
      });
      const text = await res.text();
let data: any = null;
try {
  data = JSON.parse(text);
} catch {
  throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
}

      if (!data.ok) throw new Error(data.error || "Failed");
      setResult(data);
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  const buyingTotal = useMemo(() => {
    return result?.totals?.buyingTotalEur ?? 0;
  }, [result]);

  const colsBuying = [
    "status","cardmarketId","name","setCode","collectorNumber","rarity",
    "isFoil","cond","qty","usedTrend","pct","unit","lineTotal",
    "ownQty","tix","edhrecRank","gameChanger"
  ];
  const colsNotFound = ["status","reason","name","setFull","setCode","collectorNumber","isFoil","qty"];

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Customer Quote (Buylist Engine)</h1>
        <p className="text-sm text-muted-foreground">
          Upload klant CSV (semicolon) met kolommen: Name;Set;Card Number;Foil;Quantity.  
          Tool doet set-mapping → match → engine payout → export.
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="space-y-1">
          <div className="text-sm font-medium">Klant CSV</div>
          <Input type="file" accept=".csv,.txt" onChange={handleFile} />
        </div>

        <Button onClick={run} disabled={loading || !csvText}>
          {loading ? "Quoting..." : "Run quote"}
        </Button>

        {result?.ok && (
          <Button
            variant="secondary"
            onClick={() => {
              const b = result.buying ?? [];
              const nb = result.notBuying ?? [];
              const nf = result.notFound ?? [];

              downloadText("buying.csv", toCsv(b, colsBuying));
              downloadText("not_buying.csv", toCsv(nb, colsBuying));
              downloadText("not_found.csv", toCsv(nf, colsNotFound));
            }}
          >
            Download CSVs
          </Button>
        )}
      </div>

      {err && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">
          {err}
        </div>
      )}

      {result?.ok && (
        <div className="rounded-xl border border-zinc-700 p-3 space-y-2">
          <div className="text-sm">
            <span className="font-medium">Counts:</span>{" "}
            {JSON.stringify(result.counts)}
          </div>
          <div className="text-sm">
            <span className="font-medium">Buying total (EUR):</span>{" "}
            {buyingTotal}
          </div>
        </div>
      )}

      {result?.ok && (
        <div className="grid gap-4">
          {/* BUYING */}
          <div className="rounded-xl border border-zinc-700 overflow-hidden">
            <div className="px-3 py-2 bg-zinc-900 text-sm font-medium">
              BUYING ({result.buying?.length ?? 0})
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-950/40">
                  <tr>
                    {["name","setCode","#","foil","qty","usedTrend","unit","lineTotal"].map(h => (
                      <th key={h} className="px-3 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(result.buying ?? []).slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-zinc-800">
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">{r.setCode}</td>
                      <td className="px-3 py-2">{r.collectorNumber ?? ""}</td>
                      <td className="px-3 py-2">{r.isFoil ? "t" : "f"}</td>
                      <td className="px-3 py-2">{r.qty}</td>
                      <td className="px-3 py-2">{r.usedTrend}</td>
                      <td className="px-3 py-2">{r.unit}</td>
                      <td className="px-3 py-2">{r.lineTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Showing first 200 rows (download CSV for full).
            </div>
          </div>

          {/* NOT BUYING */}
          <div className="rounded-xl border border-zinc-700 overflow-hidden">
            <div className="px-3 py-2 bg-zinc-900 text-sm font-medium">
              NOT BUYING ({result.notBuying?.length ?? 0})
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-950/40">
                  <tr>
                    {["name","setCode","#","foil","qty","usedTrend","unit","ownQty"].map(h => (
                      <th key={h} className="px-3 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(result.notBuying ?? []).slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-zinc-800">
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">{r.setCode}</td>
                      <td className="px-3 py-2">{r.collectorNumber ?? ""}</td>
                      <td className="px-3 py-2">{r.isFoil ? "t" : "f"}</td>
                      <td className="px-3 py-2">{r.qty}</td>
                      <td className="px-3 py-2">{r.usedTrend}</td>
                      <td className="px-3 py-2">{r.unit}</td>
                      <td className="px-3 py-2">{r.ownQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Showing first 200 rows (download CSV for full).
            </div>
          </div>

          {/* NOT FOUND */}
          <div className="rounded-xl border border-zinc-700 overflow-hidden">
            <div className="px-3 py-2 bg-zinc-900 text-sm font-medium">
              NOT FOUND ({result.notFound?.length ?? 0})
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-950/40">
                  <tr>
                    {["reason","name","setFull","setCode","#","foil","qty"].map(h => (
                      <th key={h} className="px-3 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(result.notFound ?? []).slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-zinc-800">
                      <td className="px-3 py-2">{r.reason}</td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">{r.setFull ?? ""}</td>
                      <td className="px-3 py-2">{r.setCode ?? ""}</td>
                      <td className="px-3 py-2">{r.collectorNumber ?? ""}</td>
                      <td className="px-3 py-2">{r.isFoil ? "t" : "f"}</td>
                      <td className="px-3 py-2">{r.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Showing first 200 rows (download CSV for full).
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
