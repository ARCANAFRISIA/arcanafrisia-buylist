// src/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import CookieBanner from "@/components/CookieBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Arcana Frisia Buylist – Magic: the Gathering kaarten verkopen",
  description:
    "Verkoop je Magic: the Gathering kaarten snel en betrouwbaar via de ArcanaFrisia Buylist. Tot 90% van Cardmarket trend, eerlijke grading en snelle uitbetaling. Gratis verzendlabel vanaf €150.",
  metadataBase: new URL("https://buylist.arcanafrisia.com"),
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background text-foreground flex flex-col`}
      >
        {/* Cookie banner (client component) */}
        <CookieBanner />

        {/* Main content */}
        <div className="flex-1 flex flex-col">
          {children}
        </div>

        {/* Global footer */}
<footer className="mt-10 border-t border-border bg-background/90 af-footer">
  <div className="max-w-5xl mx-auto px-4 py-6 text-xs md:text-sm text-muted-foreground flex flex-col items-center gap-2 md:flex-row md:justify-between">
    <nav className="af-footer-nav">
      <Link href="/klachtenregeling" className="af-footer-link">
        Klachtenregeling
      </Link>
      <span className="af-footer-sep">•</span>
      <Link href="/privacy" className="af-footer-link">
        Privacyverklaring
      </Link>
      <span className="af-footer-sep">•</span>
      <Link href="/algemene-voorwaarden" className="af-footer-link">
        Algemene voorwaarden
      </Link>
      <span className="af-footer-sep">•</span>
      <Link href="/inkoopvoorwaarden" className="af-footer-link">
        Inkoopvoorwaarden
      </Link>
    </nav>

    <div className="text-center md:text-right">
      Arcana Frisia – inkoopplatform voor Magic: The Gathering kaarten.
    </div>
  </div>
</footer>



      </body>
    </html>
  );
}
