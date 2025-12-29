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

  const [fullName, setFullName] = useState("");
const [addressLine1, setAddressLine1] = useState("");
const [postalCode, setPostalCode] = useState("");
const [city, setCity] = useState("");
const [country, setCountry] = useState("Nederland");

const [payoutMethod, setPayoutMethod] = useState<"BANK" | "PAYPAL">("BANK");
const [iban, setIban] = useState("");
const [paypalEmail, setPaypalEmail] = useState("");

const [shippingMethod, setShippingMethod] = useState<"SELF" | "LABEL">("SELF");

const [acceptTerms, setAcceptTerms] = useState(false);




  const total = items.reduce((s, i) => s + i.payout * i.qty, 0);
  const labelIsFree = total >= 150; // gratis label vanaf €150



const handleSubmit = async () => {
  setError("");

  // --- BASISVALIDATIE ---
  if (!email || !email.includes("@")) {
    setError("Vul een geldig e-mailadres in.");
    return;
  }

  if (items.length === 0) {
    setError("Je mandje is leeg.");
    return;
  }

  // --- NIEUW: NAAM + ADRES ---
  if (!fullName.trim()) {
    setError("Vul je naam in.");
    return;
  }

  if (
    !addressLine1.trim() ||
    !postalCode.trim() ||
    !city.trim() ||
    !country.trim()
  ) {
    setError("Vul je volledige adres in.");
    return;
  }

  // --- NIEUW: Payout methode ---
  if (!payoutMethod) {
    setError("Kies een betaalmethode.");
    return;
  }

  if (payoutMethod === "BANK") {
    if (!iban.trim()) {
      setError("Vul je IBAN in voor bankoverschrijving.");
      return;
    }
  }

  if (payoutMethod === "PAYPAL") {
    if (!paypalEmail || !paypalEmail.includes("@")) {
      setError("Vul een geldig PayPal e-mailadres in.");
      return;
    }
  }
  if (!acceptTerms) {
    setError(
      "Je moet akkoord gaan met de inkoopvoorwaarden."
    );
    return;
  }

  setLoading(true);


    try {
      const res = await fetch("/api/cart/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
body: JSON.stringify({
  email,
  fullName,
  addressLine1,
  postalCode,
  city,
  country,
  payoutMethod,
  iban,
  paypalEmail,
  items: items.map((i) => ({
    idProduct: i.cardmarketId,
    isFoil: i.foil,
    qty: i.qty,
    cond: i.condition,
  })),
  meta: {
    clientTotal: total,
    shippingMethod, // "SELF" of "LABEL"
    termsAcceptedAt: new Date().toISOString(),
    sellerType: "CONSUMER",
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
            <a href="/" className="underline text-[#C9A24E]">buylist</a>.
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
  {i.set}
  {i.collectorNumber ? ` #${i.collectorNumber}` : ""} • {i.condition} • Qty {i.qty}
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

<div className="grid gap-4 md:grid-cols-2">
  <div>
    <label className="block text-sm mb-1 af-muted">Naam*</label>
    <Input
      value={fullName}
      onChange={(e) => setFullName(e.target.value)}
      placeholder="Jouw naam"
      className="mb-3 h-11 text-sm af-card border px-3 af-text"
    />
  </div>
  <div>
    <label className="block text-sm mb-1 af-muted">E-mail adres*</label>
    <Input
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      placeholder="jij@example.com"
      className="mb-3 h-11 text-sm af-card border px-3 af-text"
    />
  </div>
</div>

<div className="grid gap-4 md:grid-cols-2">
  <div>
    <label className="block text-sm mb-1 af-muted">Adres*</label>
    <Input
      value={addressLine1}
      onChange={(e) => setAddressLine1(e.target.value)}
      placeholder="Straat + huisnummer"
      className="mb-3 h-11 text-sm af-card border px-3 af-text"
    />
  </div>
  <div>
    <label className="block text-sm mb-1 af-muted">Postcode*</label>
    <Input
      value={postalCode}
      onChange={(e) => setPostalCode(e.target.value)}
      placeholder="1234AB"
      className="mb-3 h-11 text-sm af-card border px-3 af-text"
    />
  </div>
</div>

<div className="grid gap-4 md:grid-cols-2">
  <div>
    <label className="block text-sm mb-1 af-muted">Plaats*</label>
    <Input
      value={city}
      onChange={(e) => setCity(e.target.value)}
      placeholder="Amsterdam"
      className="mb-3 h-11 text-sm af-card border px-3 af-text"
    />
  </div>
  <div>
    <label className="block text-sm mb-1 af-muted">Land*</label>
    <Input
      value={country}
      onChange={(e) => setCountry(e.target.value)}
      placeholder="Nederland"
      className="h-11 text-sm af-card border px-3 af-text"
    />
  </div>
</div>


{/* Betaalmethode */}
<div className="mt-4 space-y-2">
  <p className="text-sm af-text">Betaalmethode</p>
  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6 text-sm">
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <input
        type="radio"
        name="payoutMethod"
        value="BANK"
        checked={payoutMethod === "BANK"}
        onChange={() => setPayoutMethod("BANK")}
      />
      <span>Bankoverschrijving (IBAN)</span>
    </label>

    <label className="inline-flex items-center gap-2 cursor-pointer">
      <input
        type="radio"
        name="payoutMethod"
        value="PAYPAL"
        checked={payoutMethod === "PAYPAL"}
        onChange={() => setPayoutMethod("PAYPAL")}
      />
      <span>PayPal</span>
    </label>
  </div>
</div>

{payoutMethod === "BANK" && (
  <div className="mt-2">
    <label className="block text-sm mb-1 af-muted">IBAN*</label>
    <Input
      value={iban}
      onChange={(e) => setIban(e.target.value)}
      placeholder="NL00BANK0123456789"
      className="h-11 text-sm af-card border px-3 af-text"
    />
  </div>
)}

{payoutMethod === "PAYPAL" && (
  <div className="mt-2">
    <label className="block text-sm mb-1 af-muted">PayPal e-mail*</label>
    <Input
      value={paypalEmail}
      onChange={(e) => setPaypalEmail(e.target.value)}
      placeholder="paypal@example.com"
      className="h-11 text-sm af-card border px-3 af-text"
    />
  </div>
)}

{/* Verzendwijze */}
<div className="mt-6 space-y-2">
  <p className="text-sm af-text">Verzendwijze</p>
  <p className="text-xs af-muted">
    {labelIsFree
      ? "Bij een buylist van €150 of meer is het verzendlabel gratis. In jouw geval: gratis verzendlabel via ArcanaFrisia."
      : "Verzendlabel via ArcanaFrisia kost €5,-. Bij een buylist van €150 of meer is het verzendlabel gratis."}
  </p>

  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6 text-sm">
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <input
        type="radio"
        name="shippingMethod"
        value="SELF"
        checked={shippingMethod === "SELF"}
        onChange={() => setShippingMethod("SELF")}
      />
      <span>Ik verstuur zelf (eigen risico)</span>
    </label>

    <label className="inline-flex items-center gap-2 cursor-pointer">
      <input
        type="radio"
        name="shippingMethod"
        value="LABEL"
        checked={shippingMethod === "LABEL"}
        onChange={() => setShippingMethod("LABEL")}
      />
      <span>
        Verzendlabel via ArcanaFrisia
        {labelIsFree ? " (gratis)" : " (€5,- door ons verzekerd)"}
      </span>
    </label>
  </div>
</div>
{/* Akkoord met voorwaarden / margeregeling */}
<div className="mt-6 text-xs sm:text-sm space-y-2">
  <label className="inline-flex items-start gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={acceptTerms}
      onChange={(e) => setAcceptTerms(e.target.checked)}
      className="mt-1"
    />
    <span className="af-text">
      Ik heb de{" "}
      <a
        href="/inkoopvoorwaarden"
        target="_blank"
        rel="noreferrer"
        className="underline text-[#C9A24E]"
      >
        inkoopvoorwaarden
      </a>{" "}
      en{" "}
      <a
        href="/algemene-voorwaarden"
        target="_blank"
        rel="noreferrer"
        className="underline text-[#C9A24E]"
      >
        algemene voorwaarden
      </a>{" "}
      gelezen en ga hiermee akkoord. Ik verklaar dat ik de kaarten als
      marge product verkoop en hierover geen btw als voorbelasting heb
      afgetrokken.
    </span>
  </label>
</div>


{error && (
  <div className="text-red-400 text-sm mb-4 mt-4">{error}</div>
)}

<Button
  className="btn-gold font-semibold text-lg px-8 py-3 mt-2"
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
