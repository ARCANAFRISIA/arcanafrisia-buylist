'use client';
import { useState } from 'react';

export default function UploadPricesPage() {
  const [jsonText, setJsonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSync() {
    try {
      setBusy(true); setMsg(null);
      const parsed = JSON.parse(jsonText);
      const res = await fetch('/api/prices/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const j = await res.json();
      setMsg(res.ok ? `OK: ${j.count} rows` : `Error: ${j.error || res.status}`);
    } catch (e: any) {
      setMsg(`Invalid JSON: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  }

  async function handleMeta() {
    try {
      setBusy(true); setMsg(null);
      const parsed = JSON.parse(jsonText);
      const ids = Array.isArray(parsed) ? parsed.map((r:any) => r.idProduct).filter(Boolean) : [];
      const res = await fetch('/api/cardmeta/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const j = await res.json();
      setMsg(res.ok ? `Meta updated: ${j.updated}` : `Error: ${j.error || res.status}`);
    } catch (e: any) {
      setMsg(`Invalid JSON: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Upload PriceGuide (dev)</h1>
      <textarea
        className="w-full h-72 p-3 border rounded"
        value={jsonText}
        onChange={e=>setJsonText(e.target.value)}
        placeholder='Plak hier je JSON…'
      />
      <div className="flex gap-3">
        <button onClick={handleSync} disabled={busy} className="px-4 py-2 rounded bg-black text-white disabled:opacity-50">
          Sync prijzen
        </button>
        <button onClick={handleMeta} disabled={busy} className="px-4 py-2 rounded bg-gray-800 text-white disabled:opacity-50">
          Scryfall meta
        </button>
      </div>
      {msg && <p className="text-sm opacity-80">{msg}</p>}
    </main>
  );
}
