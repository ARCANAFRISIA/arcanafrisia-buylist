// src/components/CookieBanner.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "cookieConsent"; // "accepted" | "rejected"

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (!existing) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const handleChoice = (value: "accepted" | "rejected") => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, value);
    }
    setVisible(false);
  };

  return (
    <div className="fixed left-0 right-0 bottom-0 z-50">
      <div className="bg-background/95 border-t border-border backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between text-xs md:text-sm">
          <div>
            <p className="font-medium mb-1">Arcana Frisia gebruikt cookies</p>
            <p className="text-muted-foreground">
              We gebruiken functionele cookies om de site goed te laten werken
              en analytische cookies om het gebruik van de buylist te verbeteren.
              Klik op <span className="font-medium">Alle cookies accepteren</span>{" "}
              als je ook analytische cookies toestaat. Kies je voor{" "}
              <span className="font-medium">Alleen noodzakelijke</span>, dan
              plaatsen we alleen de minimale cookies.
            </p>
            <p className="mt-1 text-muted-foreground">
  Meer informatie vind je in onze{" "}
  <Link href="/privacy" className="underline text-[#C9A24E]">
    privacyverklaring
  </Link>
  .
</p>

          </div>
          <div className="flex gap-2 justify-end shrink-0">
            <button
              type="button"
              onClick={() => handleChoice("rejected")}
              className="px-3 py-1.5 rounded-lg border border-border text-xs md:text-sm hover:bg-muted transition"
            >
              Alleen noodzakelijke
            </button>
            <button
              type="button"
              onClick={() => handleChoice("accepted")}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs md:text-sm hover:opacity-90 transition"
            >
              Alle cookies accepteren
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
