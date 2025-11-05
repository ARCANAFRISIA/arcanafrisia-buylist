"use client";
import { useState } from "react";

export default function CmToCtTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/tools/cm-to-ct", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cm_to_ct_prices.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">CM → CT prijs-checker</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full border rounded p-2"
        />
        <button
          type="submit"
          disabled={!file || busy}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        >
          {busy ? "Bezig…" : "Upload & download CSV"}
        </button>
      </form>
      <div className="mt-6 text-sm">
        <a className="underline" href="/api/tools/cm-to-ct" >
          Download template CSV
        </a>
      </div>
    </div>
  );
}
