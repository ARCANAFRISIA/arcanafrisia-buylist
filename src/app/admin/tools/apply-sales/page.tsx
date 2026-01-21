"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ApplySalesTool() {
  const [account, setAccount] = useState<"MAIN" | "CTBULK">("MAIN");

  const [limit, setLimit] = useState("250");
  const [simulate, setSimulate] = useState(true);
  const [since, setSince] = useState("");
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null); setOut(null);
    try {
      const p = new URLSearchParams();
      if (limit) p.set("limit", limit);
      p.set("simulate", simulate ? "1" : "0");
      if (since) p.set("since", since);

      const endpoint = account === "CTBULK"
        ? "/api/admin/apply-sales-ctbulk"
        : "/api/admin/apply-sales";

      const res = await fetch(`${endpoint}?${p.toString()}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body));
      setOut(body);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Run apply-sales</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <label htmlFor="limit" className="block text-sm mb-1">Limit</label>
          <Input id="limit" value={limit} onChange={e => setLimit(e.target.value)} />
        </div>

        <div className="flex items-center gap-2 pt-6">
          <input
            id="simulate"
            type="checkbox"
            checked={simulate}
            onChange={e => setSimulate(e.target.checked)}
          />
          <label htmlFor="simulate" className="text-sm">Simulate</label>
        </div>

        <div>
          <label htmlFor="since" className="block text-sm mb-1">Since (ISO, opt.)</label>
          <Input
            id="since"
            value={since}
            onChange={e => setSince(e.target.value)}
            placeholder="2026-01-09T21:00:00Z"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={account === "MAIN" ? "default" : "outline"}
          onClick={() => setAccount("MAIN")}
        >
          MAIN
        </Button>
        <Button
          type="button"
          variant={account === "CTBULK" ? "default" : "outline"}
          onClick={() => setAccount("CTBULK")}
        >
          CTBULK
        </Button>
      </div>

      <Button onClick={run} disabled={loading} className="min-w-[160px]">
        {loading ? "Running…" : "Run apply-sales"}
      </Button>

      {err && (
        <pre className="bg-red-950/30 text-red-300 p-3 rounded-md text-sm overflow-x-auto">{err}</pre>
      )}
      {out && (
        <pre className="bg-zinc-900 p-3 rounded-md text-sm overflow-x-auto">
          {JSON.stringify(out, null, 2)}
        </pre>
      )}
      <p className="text-sm text-zinc-400">Tip: run dit vóór Post-Sales/Idle export.</p>
    </div>
  );
}
