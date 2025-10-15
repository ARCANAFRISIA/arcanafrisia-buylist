'use client'
import { useEffect, useMemo, useState } from 'react'

type Item = { id: bigint | number; name: string; setCode: string; lang: string; isFoil: boolean; trend: number; buyPrice: number }

export default function Home() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Item[]>([])
  const [cart, setCart] = useState<Record<string, { item: Item; qty: number }>>({})
  const pct = process.env.NEXT_PUBLIC_BUY_PCT || '62'
  const labelThreshold = Number(process.env.NEXT_PUBLIC_LABEL_THRESHOLD || '50')

  useEffect(() => {
    const ac = new AbortController()
    const run = async () => {
      if (!q) return setResults([])
      const res = await fetch(`/api/buy/prices?q=${encodeURIComponent(q)}`, { signal: ac.signal })
      const data = await res.json()
      setResults(data.items || [])
    }
    run().catch(() => {})
    return () => ac.abort()
  }, [q])

  const total = useMemo(() => Object.values(cart).reduce((s, c) => s + c.item.buyPrice * c.qty, 0), [cart])

  const add = (it: Item) =>
    setCart((prev) => {
      const key = String(it.id)
      const cur = prev[key]?.qty || 0
      return { ...prev, [key]: { item: it, qty: cur + 1 } }
    })

  const setQty = (key: string, qty: number) =>
    setCart((prev) => ({ ...prev, [key]: { ...prev[key], qty: Math.max(0, qty) } }))

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Buylist MVP — Demo</h1>
      <p className="text-sm opacity-80 mb-4">
        Wij betalen <b>{pct}%</b> van Cardmarket trend. Gratis verzendlabel vanaf <b>€{labelThreshold}</b>.
      </p>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Zoek kaartnaam…"
        className="border rounded px-3 py-2 w-full mb-4"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {results.map((it) => (
          <div key={String(it.id)} className="border rounded p-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="font-medium">
                {it.name} <span className="opacity-60">({it.setCode})</span>
              </div>
              <div className="text-sm opacity-70">
                Trend €{it.trend.toFixed(2)} → Onze buy €{it.buyPrice.toFixed(2)}
              </div>
            </div>
            <button onClick={() => add(it)} className="border rounded px-3 py-1">
              + Voeg toe
            </button>
          </div>
        ))}
      </div>

      {/* Cart */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex-1 overflow-x-auto">
            <div className="flex items-center gap-3">
              {Object.entries(cart).map(([key, { item, qty }]) => (
                <div key={key} className="border rounded px-3 py-1 text-sm flex items-center gap-2">
                  <span>
                    {item.name} ({item.setCode})
                  </span>
                  <input
                    type="number"
                    className="w-16 border rounded px-2 py-1"
                    value={qty}
                    onChange={(e) => setQty(key, Number(e.target.value))}
                  />
                  <span>€{(item.buyPrice * qty).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="font-semibold">Totaal: €{total.toFixed(2)}</div>
          <button className="bg-black text-white rounded px-4 py-2">Submit (mock)</button>
        </div>
      </div>
    </div>
  )
}
