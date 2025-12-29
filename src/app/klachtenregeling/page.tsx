"use client";

import BuyHeader from "@/components/buy/BuyHeader";

export default function KlachtenregelingPage() {
  return (
    <div
      className="min-h-screen text-slate-200 af-page"
      style={{ background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)" }}
    >
      <BuyHeader />

      <main className="mx-auto max-w-[1200px] px-6 lg:px-12 pt-16 pb-16">
        <h1 className="text-3xl font-bold mb-4">Klachtenregeling</h1>
        <p className="mb-4 text-sm">
          We vinden het belangrijk dat je tevreden bent over onze dienstverlening.
          Toch kan het gebeuren dat er iets niet helemaal loopt zoals verwacht.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          1. Klachten over de buylist
        </h2>
        <p className="mb-3 text-sm">
          Het kan altijd voorkomen dat er iets niet helemaal gaat zoals gepland.
          We raden je aan om klachten eerst bij ons kenbaar te maken door te
          mailen naar{" "}
          <a
            href="mailto:info@arcanafrisia.com"
            className="af-page-link"
          >
            info@arcanafrisia.com
          </a>
          . Omschrijf je klacht zo duidelijk mogelijk en vermeld indien van
          toepassing je buylistreferentie of ordernummer.
        </p>
        <p className="mb-3 text-sm">
          We reageren uiterlijk binnen 14 dagen na ontvangst van je klacht.
          Als we meer tijd nodig hebben, laten we je weten wanneer je een
          uitgebreidere reactie kunt verwachten.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          2. Geschilbemiddeling via WebwinkelKeur
        </h2>
        <p className="mb-3 text-sm">
          Leidt dit niet tot een oplossing, dan is het mogelijk om je geschil
          aan te melden voor bemiddeling via WebwinkelKeur. Dit kan via{" "}
          <a
            href="https://www.webwinkelkeur.nl/kennisbank/consumenten/geschil"
            target="_blank"
            rel="noreferrer"
            className="af-page-link"
          >
            de geschillenpagina van WebwinkelKeur
          </a>
          .
        </p>
        <p className="mb-3 text-sm">
          Vanaf 15 februari 2016 kunnen consumenten in de EU klachten ook
          aanmelden via het ODR-platform van de Europese Commissie. Dit
          platform is te vinden op{" "}
          <a
            href="https://ec.europa.eu/consumers/odr"
            target="_blank"
            rel="noreferrer"
            className="af-page-link"
          >
            https://ec.europa.eu/consumers/odr
          </a>
          . Als je klacht nog niet elders in behandeling is, staat het je vrij
          om je klacht te deponeren via het platform van de Europese Unie.
        </p>
      </main>
    </div>
  );
}
