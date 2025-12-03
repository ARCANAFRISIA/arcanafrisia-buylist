"use client";

import { useCart } from "@/lib/store/cart";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SubmitPage() {
  const cart = useCart();
  const router = useRouter();

  const items = cart.items;
  const empty = items.length === 0;

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const total = items.reduce((s, i) => s + i.payout * i.qty, 0);

  const handleSubmit = async () => {
    setError("");

    if (!email || !email.includes("@")) {
      setError("Vul een geldig e-mailadres in.");
      return;
    }

    if (items.length === 0) {
      setError("Je mandje is leeg.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/cart/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          items: items.map((i) => ({
            idProduct: i.cardmarketId, // let op: jouw backend gebruikt nu productId → die map ik hieronder
            isFoil: i.foil,
            qty: i.qty,
            cond: i.condition,
          })),
          meta: {
            clientTotal: total,
          },
        }),
      });

      const msg = await res.json();

      if (!msg.ok) {
        setError(msg.error || "Er ging iets mis.");
        setLoading(false);
        return;
      }

      // Cart legen & redirect
      cart.clear();
      router.push(`/submit/thanks?id=${msg.submission.id}`);

    } catch (err) {
      console.error(err);
      setError("Serverfout. Probeer het later opnieuw.");
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen text-slate-200 px-6 lg:px-12 py-12"
      style={{ background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)" }}
    >
      <div className="mx-auto w-full max-w-[900px]">
        <h1 className="text-3xl font-semibold af-text mb-6">Buylist Indienen</h1>

        {empty ? (
          <div className="af-muted mt-6">
            Je mandje is leeg. Ga terug naar de{" "}
            <a href="/buy" className="underline text-[#C9A24E]">buylist</a>.
          </div>
        ) : (
          <>
            {/* CART OVERZICHT */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-6 mb-10">
  <h2 className="text-xl af-text mb-4">Overzicht van je kaarten</h2>

  <div className="divide-y divide-[var(--border)]">
    {items.map((i) => (
      <div
        key={`${i.id}-${i.condition}-${i.foil}-${i.qty}`}
        className="py-4 flex items-center justify-between text-sm"
      >
        <div className="flex flex-col">
          <span className="font-medium af-text">
            {i.name}
            {i.foil ? " (Foil)" : ""}
          </span>
          <span className="af-muted text-xs">
            {i.set} • {i.condition} • Qty {i.qty}
          </span>
        </div>

        <div className="tabular-nums font-semibold" style={{ color: "#C9A24E" }}>
          € {(i.payout * i.qty).toFixed(2)}
        </div>
      </div>
    ))}
  </div>

  <div className="mt-6 pt-4 border-t border-[var(--border)] text-right text-xl font-bold" style={{ color: "#C9A24E" }}>
    Totaal: € {total.toFixed(2)}
  </div>
</div>

            

            {/* EMAIL FORM */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-6">
              <h2 className="text-xl af-text mb-4">Contactgegevens</h2>

              <label className="block text-sm mb-1 af-muted">E-mail adres</label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jij@example.com"
                className="mb-3 h-12 text-base af-card border px-3 af-text"
              />

              {error && (
                <div className="text-red-400 text-sm mb-4">{error}</div>
              )}

              <Button
                className="btn-gold font-semibold text-lg px-8 py-3"
                disabled={loading}
                onClick={handleSubmit}
              >
                {loading ? "Versturen…" : "Buylist versturen"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
