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
  sourceDate: string;
  unitCostEur: number;
};

type UploadResult = {
  ok: boolean;
  rowsParsed?: number;
  rowsConsolidated?: number;
  lotsCreated?: number;
  balancesUpserted?: number;
  setLocationCount?: number;
  rowErrors?: { line: number; message: string }[];
  warnings?: any[];
  picklist?: PickRow[];
  error?: string;
};

type PreviewRow = {
  line: number;
  cardmarketId: string;
  qty: string;
  condition: string;
  language: string;
  sourceCode: string;
  unitCostEur: string;
  name: string;
};

function detectDelimiter(text: string) {
  const firstLine = (text || "").split(/\r?\n/)[0] || "";
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  return semicolons > commas ? ";" : ",";
}

function parseCsvLine(line: string, delimiter: string) {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeHeader(s: string) {
  return String(s || "").replace(/^\uFEFF/, "").trim();
}

function getField(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function normalizeCondition(v: string) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return "";
  if (s === "NEAR MINT") return "NM";
  if (s === "MINT") return "NM";
  if (s === "EXCELLENT") return "EX";
  if (s === "GOOD") return "GD";
  if (s === "LIGHT PLAYED") return "LP";
  if (s === "MODERATE PLAYED") return "MP";
  if (s === "HEAVY PLAYED") return "HP";
  if (s === "POOR") return "PO";
  return s;
}

function normalizeLanguage(v: string) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "EN";
  if (["english", "en", "eng"].includes(s)) return "EN";
  if (["german", "de", "ger", "deutsch"].includes(s)) return "DE";
  if (["french", "fr", "fra", "français", "francais"].includes(s)) return "FR";
  if (["spanish", "es", "spa", "español", "espanol"].includes(s)) return "ES";
  if (["italian", "it", "ita", "italiano"].includes(s)) return "IT";
  if (["portuguese", "pt", "por"].includes(s)) return "PT";
  if (["japanese", "jp", "ja"].includes(s)) return "JP";
  return String(v || "EN").trim().toUpperCase();
}

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

  const csvPreview = useMemo<PreviewRow[]>(() => {
    if (!csvText.trim()) return [];

    const lines = csvText
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    if (lines.length < 2) return [];

    const delimiter = detectDelimiter(csvText);
    const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);

    const previewRows: PreviewRow[] = [];

    for (let i = 1; i < lines.length && previewRows.length < 12; i++) {
      const values = parseCsvLine(lines[i], delimiter);

      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] ?? "";
      });

      const cardmarketId = getField(row, ["cardmarketId", "CardmarketId", "idProduct"]);
      const qty = getField(row, ["qty", "quantity", "qtyOnHand"]);
      const condition = normalizeCondition(getField(row, ["condition", "state"]));
      const language = normalizeLanguage(getField(row, ["language", "lang"]));
      const sourceCode =
        getField(row, ["sourceCode"]) ||
        getField(row, ["comment"]) ||
        defaultSourceCode ||
        "IMPORT";
      const unitCostEur =
        getField(row, ["unitCostEur", "avgUnitCostEur", "costPrice"]) ||
        getField(row, ["price"]) ||
        "";
      const name = getField(row, ["name"]);

      previewRows.push({
        line: i + 1,
        cardmarketId,
        qty,
        condition,
        language,
        sourceCode,
        unitCostEur,
        name,
      });
    }

    return previewRows;
  }, [csvText, defaultSourceCode]);

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
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
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
        <p>Velden die wij gebruiken:</p>
        <pre className="bg-black/40 p-2 rounded text-xs overflow-x-auto">
{`cardmarketId, quantity/qty, condition, language, sourceCode/comment, unitCostEur/price, name`}
        </pre>
      </div>

      <div className="text-sm opacity-80">
        Alles wat je hier uploadt komt binnen op set-locatie als <span className="font-mono">SET-SETCODE</span>.
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

      {csvPreview.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Preview wat er wordt opgepakt</div>
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/10">
            <table className="min-w-full text-sm">
              <thead className="bg-black/30">
                <tr>
                  <th className="text-left p-2">line</th>
                  <th className="text-left p-2">cmid</th>
                  <th className="text-right p-2">qty</th>
                  <th className="text-left p-2">cond</th>
                  <th className="text-left p-2">lang</th>
                  <th className="text-left p-2">source</th>
                  <th className="text-right p-2">cost</th>
                  <th className="text-left p-2">name</th>
                </tr>
              </thead>
              <tbody>
                {csvPreview.map((r) => (
                  <tr key={r.line} className="odd:bg-black/10">
                    <td className="p-2 font-mono">{r.line}</td>
                    <td className="p-2 font-mono">{r.cardmarketId || "—"}</td>
                    <td className="p-2 text-right font-mono">{r.qty || "—"}</td>
                    <td className="p-2 font-mono">{r.condition || "—"}</td>
                    <td className="p-2 font-mono">{r.language || "—"}</td>
                    <td className="p-2 font-mono">{r.sourceCode || "—"}</td>
                    <td className="p-2 text-right font-mono">{r.unitCostEur || "—"}</td>
                    <td className="p-2">{r.name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs opacity-70">
            Preview toont de eerste 12 regels zoals de importer ze uitleest.
          </div>
        </div>
      )}

      <details className="space-y-2">
        <summary className="cursor-pointer text-sm font-medium opacity-90">
          Toon ruwe CSV-inhoud
        </summary>
        <div className="pt-2">
          <textarea
            className="min-h-[160px] w-full rounded-md border px-3 py-2 bg-black/20 font-mono text-xs"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
        </div>
      </details>

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
              {typeof result.setLocationCount === "number"
                ? ` · setLocations: ${result.setLocationCount}`
                : ""}
            </div>

            {picklist.length > 0 && (
              <div className="opacity-90 mt-1">picklist rows: {picklist.length}</div>
            )}
          </div>

          {picklist.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm opacity-80">
                  Picklist: location → set → name → condition
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
                Dit is je neerleg-lijst voor deze upload.
              </div>
            </div>
          )}

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

          <details className="rounded-md border border-zinc-700/50 bg-black/20 p-3">
            <summary className="cursor-pointer text-sm opacity-90">Toon raw JSON</summary>
            <pre className="mt-3 text-xs whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}