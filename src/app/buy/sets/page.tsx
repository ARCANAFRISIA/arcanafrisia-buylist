"use client";

import BuyHeader from "@/components/buy/BuyHeader";

export default function ComingSoonSets() {
  return (
    <div
      className="min-h-screen text-slate-200"
      style={{ background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)" }}
    >
      <BuyHeader />

      <main className="mx-auto max-w-[1200px] px-6 lg:px-12 pt-16">
        <h1 className="text-3xl font-bold mb-4">Sets – Coming Soon</h1>
        <p className="text-slate-400">
          Binnenkort kun je hier per set kaarten bekijken en verkopen.
          Tot die tijd kun je de filter functies op de homepage gebruiken om per set kaarten te zoeken.
        </p>
      </main>
    </div>
  );
}
