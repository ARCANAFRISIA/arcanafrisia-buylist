"use client";

import BuyHeader from "@/components/buy/BuyHeader";

export default function ComingSoonAccount() {
  return (
    <div
      className="min-h-screen text-slate-200"
      style={{ background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)" }}
    >
      <BuyHeader />

      <main className="mx-auto max-w-[1200px] px-6 lg:px-12 pt-16">
        <h1 className="text-3xl font-bold mb-4">Account – Coming Soon</h1>
        <p className="text-slate-400">
          Account-functies zoals inzendingen volgen, statusgeschiedenis en
          betalingen worden binnenkort toegevoegd.
        </p>
        <p className="text-slate-400 mt-2">
          Voor nu ontvang je alle updates automatisch per e-mail bij iedere
          statuswijziging.
        </p>
      </main>
    </div>
  );
}
