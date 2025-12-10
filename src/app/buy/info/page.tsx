"use client";

import BuyHeader from "@/components/buy/BuyHeader";

export default function BuyInfoPage() {
  return (
    <div
      className="min-h-screen text-slate-200"
      style={{
        background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)",
      }}
    >
      <BuyHeader />

      {/* Zelfde breedte / padding als List upload & homepage */}
      <main className="mx-auto w-full max-w-[1200px] px-6 lg:px-12 pb-16 pt-10 space-y-8">
        <header className="mb-4">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Hoe werkt verkopen via de ArcanaFrisia Buylist?
          </h1>
          <p className="mt-2 text-sm md:text-base af-muted">
            Hier lees je stap voor stap hoe je je Magic: the Gathering kaarten
            via onze buylist kunt verkopen, hoe het verzenden werkt en wanneer je
            uitbetaling kunt verwachten.
          </p>
        </header>

        <section className="space-y-6 text-sm md:text-base leading-relaxed">
          <div>
            <h2 className="text-xl font-semibold mb-2">
              1. Kaarten zoeken en toevoegen
            </h2>
            <ul className="list-disc pl-5 space-y-1 af-muted">
              <li>Zoek op kaartnaam of blader door de sets in de buylist.</li>
              <li>
                Kies per kaart de juiste conditie (NM / EX / GD / PL / PO) en of het
                foil is.
              </li>
              <li>
                Controleer de payout per kaart en klik op <strong>Add</strong> om
                kaarten toe te voegen.
              </li>
              <li>
                Via het winkelwagen-icoon ga je naar de pagina{" "}
                <strong>Buylist indienen</strong>.
              </li>
            </ul>
            <p className="af-muted mt-2">
              De buylist toont alleen de kaarten die we op dit moment inkopen,
              met prijzen gebaseerd op Cardmarket trend.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">2. Buylist indienen</h2>
            <p className="af-muted mb-2">
              Op de pagina <strong>Buylist indienen</strong> zie je een
              overzicht van al je kaarten met aantallen, conditie en
              totaalbedrag. Daarnaast vul je je gegevens in:
            </p>
            <ul className="list-disc pl-5 space-y-1 af-muted">
              <li>Naam en e-mailadres</li>
              <li>Adres: straat, huisnummer, postcode, plaats en land</li>
              <li>Betaalmethode: bankoverschrijving (IBAN) of PayPal</li>
              <li>Verzendwijze: zelf versturen of verzendlabel via ArcanaFrisia</li>
            </ul>
            <p className="af-muted mt-2">
              Na het versturen krijg je direct een bevestigingsmail met je
              referentienummer, het overzicht van je kaarten en alle verzend- en
              inpak-instructies. Je mag je kaarten daarna meteen versturen.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">3. Verzendopties</h2>

            <h3 className="font-semibold mb-1">
              Optie 1 – Je verstuurt zelf (eigen risico)
            </h3>
            <p className="af-muted mb-2">
              Je stuurt de kaarten zelf naar ons op met een verzendmethode naar
              keuze. In de mail staat het exacte verzendadres. We raden een
              bubbelenvelop of stevige doos met tracking aan. Verlies of schade
              ligt bij deze optie bij de verzender.
            </p>

            <h3 className="font-semibold mb-1">
              Optie 2 – Verzendlabel via ArcanaFrisia
            </h3>
            <p className="af-muted">
              Je kunt ook kiezen voor een verzendlabel dat wij voor je
              aanmaken:
            </p>
            <ul className="list-disc pl-5 space-y-1 af-muted mt-1">
              <li>Kosten: € 5,-</li>
              <li>Gratis bij een buylist van € 150,- of meer</li>
              <li>Je ontvangt binnen 1 werkdag een label of barcode per e-mail</li>
              <li>Het pakket is via ons verzekerd volgens onze voorwaarden</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">4. Inpakken & sorteren</h2>
            <ul className="list-disc pl-5 space-y-1 af-muted">
              <li>
                Sorteer de kaarten in dezelfde volgorde als in de
                bevestigingsmail.
              </li>
              <li>
                Verwijder sleeves/toploaders waar mogelijk (duurdere kaarten &gt; € 25
                mogen natuurlijk goed beschermd blijven).
              </li>
              <li>
                Bundel kaarten in een zakje of team bag en gebruik een stevige
                verpakking of bubbelenvelop.
              </li>
              <li>
                Voeg bij voorkeur een briefje toe met je naam, e-mail en
                buylist-referentie.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">
              5. Ontvangst, controle & grading
            </h2>
            <p className="af-muted mb-2">
              Zodra je pakket bij ons binnen is, zetten we de status op{" "}
              <strong>Ontvangen</strong> en controleren we je kaarten op
              aantal, versie en conditie.
            </p>
            <p className="af-muted mb-2">
              Kleine verschillen in conditie (bijvoorbeeld EX in plaats van NM)
              kunnen zorgen voor een lichte aanpassing in het totaalbedrag. We
              passen je buylist alleen aan op versie/conditie en aantallen.
            </p>
            <p className="af-muted">
              Bij een wijziging krijg je een status <strong>Adjusted</strong> met
              toelichting en nieuw totaalbedrag. Daarna volgen{" "}
              <strong>Approved</strong> en uiteindelijk <strong>Paid</strong>. Bij
              elke stap ontvang je een e-mail.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">6. Uitbetaling</h2>
            <p className="af-muted">
              Na goedkeuring betalen we meestal binnen{" "}
              <strong>1–2 werkdagen</strong> uit. Bij bankoverschrijving is het
              afhankelijk van je bank wanneer het zichtbaar is; bij PayPal
              storten we naar het door jou opgegeven PayPal-adres.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">
              7. Grote collecties of vragen
            </h2>
            <p className="af-muted">
              Wil je een grote collectie, volledige binder of speciale set
              verkopen? Mail ons op <strong>info@arcanafrisia.com</strong> met
              een korte beschrijving (formaat, sets, geschatte waarde). We
              denken graag mee en doen indien nodig een maatwerkvoorstel.
            </p>
          </div>

          <p className="text-xs af-muted mt-6">
            Tip: check ook je spamfolder als je geen e-mails van ons ziet.
          </p>
        </section>
      </main>
    </div>
  );
}
