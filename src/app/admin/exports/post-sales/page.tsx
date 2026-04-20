"use client";

import { useState } from "react";

type Row = {
  cardmarketId: string;
  foil: string;
  cond: string;
  language: string;
  addQty: string;
  price: string;
  policy: string;
  sourceCode: string;
  location?: string;
  comment?: string;
};

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const nextChar = csv[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (char === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    currentField += char;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

export default function PostSalesPage() {
  const [mode, setMode] = useState<"relist" | "newstock" | "full">("relist");
  const [markupPct, setMarkupPct] = useState<string>("0.05");
  const [since, setSince] = useState<string>("");
  const [noCursor, setNoCursor] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const buildUrl = (withNoCursor: boolean) => {
    const params = new URLSearchParams();
    params.set("mode", mode);
    params.set("markupPct", markupPct || "0.05");
    if (since) params.set("since", since);
    if (withNoCursor) params.set("noCursor", "1");
    return `/api/export/post-sales?${params.toString()}`;
  };

  const parseRows = (csv: string): Row[] => {
    const parsed = parseCsv(csv);
    if (parsed.length <= 1) return [];

    return parsed.slice(1).filter((parts) => parts.some((p) => p !== "")).map((parts) => ({
      cardmarketId: parts[0] ?? "",
      foil: parts[1] ?? "",
      cond: parts[2] ?? "",
      language: parts[3] ?? "",
      addQty: parts[4] ?? "",
      price: parts[5] ?? "",
      policy: parts[6] ?? "",
      sourceCode: parts[7] ?? "",
      location: parts[8] ?? "",
      comment: parts[9] ?? "",
    }));
  };

  const handlePreview = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(buildUrl(noCursor), { method: "GET" });
      if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
      const csv = await res.text();
      setRows(parseRows(csv));
    } catch (e: any) {
      setError(e.message || "Preview failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    const url = buildUrl(false);
    window.location.href = url;
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Post-Sales Export</h1>
      <div className="text-sm opacity-80">
        CM export. Relist = recent verkocht, newstock = recent geüpload, full = huidige CM-voorraad.
        Pricing gebruikt relist last sold + markup, anders CT min vs CM trend.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
        <div>
          <label className="block text-sm mb-1">Mode</label>
          <select
            className="w-full rounded-md border px-3 py-2 bg-black/20"
            value={mode}
            onChange={(e) => setMode(e.target.value as "relist" | "newstock" | "full")}
          >
            <option value="relist">relist</option>
            <option value="newstock">newstock</option>
            <option value="full">full</option>
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">Markup % (0.05 = 5%)</label>
          <input
            className="w-full rounded-md border px-3 py-2 bg-black/20"
            value={markupPct}
            onChange={(e) => setMarkupPct(e.target.value)}
            placeholder="0.05"
            inputMode="decimal"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm mb-1">Since (ISO, optioneel)</label>
          <input
            className="w-full rounded-md border px-3 py-2 bg-black/20"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            placeholder="2026-01-08T00:00:00Z"
          />
          <div className="text-xs opacity-70 mt-1">Leeg = cursor per mode. Full negeert since.</div>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="nocursor"
            type="checkbox"
            className="h-5 w-5"
            checked={noCursor}
            onChange={(e) => setNoCursor(e.target.checked)}
          />
          <label htmlFor="nocursor" className="text-sm">
            Cursor niet bijwerken (preview)
          </label>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handlePreview}
          disabled={loading}
          className="rounded-xl px-4 py-2 border hover:opacity-90"
        >
          {loading ? "Preview…" : "Preview"}
        </button>

        <button onClick={handleDownload} className="rounded-xl px-4 py-2 border hover:opacity-90">
          Download CSV
        </button>
      </div>

      {error && <div className="text-red-400">{error}</div>}

      {rows.length > 0 && (
        <div className="overflow-x-auto border rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-black/30">
              <tr>
                <th className="text-left p-2">cardmarketId</th>
                <th className="text-left p-2">foil</th>
                <th className="text-left p-2">cond</th>
                <th className="text-left p-2">language</th>
                <th className="text-left p-2">addQty</th>
                <th className="text-left p-2">price</th>
                <th className="text-left p-2">policy</th>
                <th className="text-left p-2">sourceCode</th>
                <th className="text-left p-2">location</th>
                <th className="text-left p-2">comment</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="odd:bg-black/10">
                  <td className="p-2">{r.cardmarketId}</td>
                  <td className="p-2">{r.foil}</td>
                  <td className="p-2">{r.cond}</td>
                  <td className="p-2">{r.language}</td>
                  <td className="p-2">{r.addQty}</td>
                  <td className="p-2">{r.price}</td>
                  <td className="p-2">{r.policy}</td>
                  <td className="p-2">{r.sourceCode}</td>
                  <td className="p-2">{r.location}</td>
                  <td className="p-2 max-w-[520px] truncate" title={r.comment}>
                    {r.comment}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 && !loading && !error && (
        <div className="text-sm opacity-70">Geen rows. Check since/cursor of mode.</div>
      )}
    </div>
  );
}