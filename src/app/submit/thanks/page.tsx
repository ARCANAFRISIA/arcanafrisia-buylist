"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function SubmitThanks() {
  const params = useSearchParams();
  const id = params.get("id");

  return (
    <div
      className="min-h-screen text-slate-200 grid place-items-center px-6"
      style={{ background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)" }}
    >
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-semibold af-text mb-3">
          Bedankt voor je buylist!
        </h1>

        <p className="af-muted mb-6">
          We hebben je inzending ontvangen en sturen je binnenkort een bevestigingsmail.
          <br />
          <br />
          <span className="af-text font-semibold">
            Referentie: {id ?? "(onbekend)"}
          </span>
        </p>

        <Link
          href="/buy"
          className="btn-gold px-6 py-3 rounded-lg font-semibold inline-block"
        >
          Terug naar buylist
        </Link>
      </div>
    </div>
  );
}
