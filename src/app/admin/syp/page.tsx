// src/app/admin/syp/page.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type Result = {
  ok: boolean;
  error?: string;

  totalRowsInFile?: number;
  magicRowsInFile?: number;
  pokemonRowsInFile?: number;
  magicRowsParsed?: number;
  upsertedRows?: number;
  hotThreshold?: number;
  hotCount?: number;
  invalidRows?: number;
  errors?: { line: number; message: string }[];

  top?: Array<{
    tcgplayerId: number;
    productName: string;
    setName: string | null;
    collectorNumber: string | null;
    rarity: string | null;
    condition: string | null;
    marketPrice: any;
    maxQty: number;
    updatedAt: string;
  }>;
};

export default function SypAdminPage() {
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(f);
  }

  async function upload() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/syp/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      });
      const json = (await res.json()) as Result;
      setResult(json);
      if (!json.ok) setError(json.error ?? "unknown error");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">SYP Import (TCGplayer demand)</h1>
          <p className="text-sm text-muted-foreground">
            Plak of upload je SYP export. We bewaren alleen Category=Magic, maar we rapporteren ook Pokemon count.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={upload} disabled={loading || !csvText.trim()}>
            {loading ? "Uploading..." : "Upload → DB"}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Input type="file" accept=".csv,text/csv" onChange={handleFile} />
        <Button
          variant="secondary"
          onClick={() => {
            setCsvText("");
            setResult(null);
            setError(null);
          }}
          disabled={loading}
        >
          Clear
        </Button>
      </div>

      <Textarea
  value={csvText}
  onChange={(e) => setCsvText(e.target.value)}
  placeholder="Paste SYP CSV here..."
  className="min-h-[260px] font-mono text-xs bg-zinc-950/60 text-zinc-100 border-zinc-700 placeholder:text-zinc-500"
/>


      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">
          <div className="font-semibold text-red-200">Error</div>
          <div className="text-red-100/90">{error}</div>
        </div>
      )}

      {result?.ok && (
        <div className="rounded-xl border p-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Rows in file" value={result.totalRowsInFile} />
            <Stat label="Magic rows (file)" value={result.magicRowsInFile} />
            <Stat label="Pokemon rows (file)" value={result.pokemonRowsInFile} />
            <Stat label="Magic parsed" value={result.magicRowsParsed} />
            <Stat label="Upserted" value={result.upsertedRows} />
            <Stat label={`Hot (>=${result.hotThreshold})`} value={result.hotCount} />
            <Stat label="Invalid rows" value={result.invalidRows} />
          </div>

          {result.errors?.length ? (
            <div className="text-sm">
              <div className="font-semibold mb-1">First errors (max 200)</div>
              <div className="max-h-48 overflow-auto rounded-md border p-2">
                {result.errors.map((e, i) => (
                  <div key={i} className="font-mono text-xs opacity-90">
                    line {e.line}: {e.message}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {result.top?.length ? (
            <div className="text-sm">
              <div className="font-semibold mb-2">Top demand (maxQty desc)</div>
              <div className="overflow-x-auto rounded-md border">
                <table className="min-w-full border-collapse text-xs">
                  <thead className="bg-zinc-900">
                    <tr>
                      <th className="px-2 py-2 text-left">MaxQty</th>
                      <th className="px-2 py-2 text-left">Name</th>
                      <th className="px-2 py-2 text-left">Set</th>
                      <th className="px-2 py-2 text-left">#</th>
                      <th className="px-2 py-2 text-left">Rarity</th>
                      <th className="px-2 py-2 text-left">Cond</th>
                      <th className="px-2 py-2 text-right">Market</th>
                      <th className="px-2 py-2 text-left">TCG ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.top.map((r) => (
                      <tr key={r.tcgplayerId} className="border-t border-zinc-800">
                        <td className="px-2 py-2">{r.maxQty}</td>
                        <td className="px-2 py-2">{r.productName}</td>
                        <td className="px-2 py-2">{r.setName ?? ""}</td>
                        <td className="px-2 py-2">{r.collectorNumber ?? ""}</td>
                        <td className="px-2 py-2">{r.rarity ?? ""}</td>
                        <td className="px-2 py-2">{r.condition ?? ""}</td>
                        <td className="px-2 py-2 text-right">
                          {r.marketPrice != null ? String(r.marketPrice) : ""}
                        </td>
                        <td className="px-2 py-2">{r.tcgplayerId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value ?? 0}</div>
    </div>
  );
}
