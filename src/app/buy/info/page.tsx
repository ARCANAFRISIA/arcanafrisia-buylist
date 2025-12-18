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
      <main className="mx-auto w-full max-w-[1200px] px-6 lg:px-12 pb-16 pt-10 space-y-10">
        <header className="mb-2">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Informatie & veelgestelde vragen
          </h1>
          <p className="mt-2 text-sm md:text-base af-muted max-w-2xl">
            Hier vind je alle informatie over verkopen via de ArcanaFrisia
            Buylist: wie wij zijn, hoe het proces werkt, hoe we kaarten graden
            en wanneer je uitbetaling kunt verwachten.
          </p>
        </header>

        {/* Over ons */}
        <section
          id="over-ons"
          className="space-y-3 text-sm md:text-base leading-relaxed scroll-mt-24"
        >
          <h2 className="text-2xl font-semibold">Over ArcanaFrisia</h2>
          <p className="af-muted">
            ArcanaFrisia is een gespecialiseerde Magic: the Gathering verkoper
            uit Nederland, met jarenlange ervaring op platforms als Cardmarket
            en Cardtrader in het inkopen en verkopen van singles. We werken dagelijks met
            voorraad, pricing en grading, zodat jij je kaarten snel, eerlijk en
            veilig kunt verkopen.
          </p>
          <p className="af-muted">
            Onze buylist is volledig data-gedreven: prijzen zijn gebaseerd op
            Cardmarket trend, aangevuld met eigen voorraaddata en populaire
            formats. Zo krijg je een marktconforme prijs zonder eindeloos
            onderhandelen of losse berichten.
          </p>
          <p className="af-muted">
            We behandelen elke inzending alsof het onze eigen collectie is:
            netjes sorteren, zorgvuldig graden en helder communiceren bij
            eventuele verschillen. Geen vaagheden, geen verrassingen.
          </p>
        </section>

        {/* Hoe werkt verkopen (jouw bestaande flow) */}
        <section
          id="hoe-werkt-het"
          className="space-y-6 text-sm md:text-base leading-relaxed scroll-mt-24"
        >
          <h2 className="text-2xl font-semibold">
            Hoe werkt verkopen via de ArcanaFrisia Buylist?
          </h2>

          <div>
            <h3 className="text-xl font-semibold mb-2">
              1. Kaarten zoeken en toevoegen
            </h3>
            <ul className="list-disc pl-5 space-y-1 af-muted">
              <li>Zoek op kaartnaam of blader door de sets in de buylist.</li>
              <li>
                Kies per kaart de juiste conditie (NM / EX / GD / PL / PO) en of
                het foil is.
              </li>
              <li>
                Controleer de payout per kaart en klik op{" "}
                <strong>Add</strong> om kaarten toe te voegen.
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
            <h3 className="text-xl font-semibold mb-2">2. Buylist indienen</h3>
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
            <h3 className="text-xl font-semibold mb-2">3. Verzendopties</h3>

            <h4 className="font-semibold mb-1">
              Optie 1 – Je verstuurt zelf (eigen risico)
            </h4>
            <p className="af-muted mb-2">
              Je stuurt de kaarten zelf naar ons op met een verzendmethode naar
              keuze. In de mail staat het exacte verzendadres. We raden een
              bubbelenvelop of stevige doos met tracking aan. Verlies of schade
              ligt bij deze optie bij de verzender.
            </p>

            <h4 className="font-semibold mb-1">
              Optie 2 – Verzendlabel via ArcanaFrisia
            </h4>
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
            <h3 className="text-xl font-semibold mb-2">
              4. Inpakken & sorteren
            </h3>
            <ul className="list-disc pl-5 space-y-1 af-muted">
              <li>
                Sorteer de kaarten in dezelfde volgorde als in de
                bevestigingsmail.
              </li>
              <li>
                Verwijder sleeves/toploaders waar mogelijk (duurdere kaarten &gt;
                € 75 mogen natuurlijk goed beschermd blijven).
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
            <h3 className="text-xl font-semibold mb-2">
              5. Ontvangst, controle & grading
            </h3>
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
              Bij een wijziging krijg je een status <strong>Adjusted</strong>{" "}
              met toelichting en nieuw totaalbedrag. Daarna volgen{" "}
              <strong>Approved</strong> en uiteindelijk <strong>Paid</strong>. Bij
              elke stap ontvang je een e-mail.
            </p>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-2">6. Uitbetaling</h3>
            <p className="af-muted">
              Na goedkeuring betalen we meestal binnen{" "}
              <strong>1–2 werkdagen</strong> uit. Bij bankoverschrijving is het
              afhankelijk van je bank wanneer het zichtbaar is; bij PayPal
              storten we naar het door jou opgegeven PayPal-adres.
            </p>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-2">
              7. Grote collecties of vragen
            </h3>
            <p className="af-muted">
              Wil je een grote collectie, volledige binder of speciale set
              verkopen? Mail ons op <strong>info@arcanafrisia.com</strong> met
              een korte beschrijving (formaat, sets, geschatte waarde). We
              denken graag mee en doen indien nodig een maatwerkvoorstel.
            </p>
          </div>
        </section>

        {/* Grading & conditie */}
        <section
          id="grading"
          className="space-y-4 text-sm md:text-base leading-relaxed scroll-mt-24"
        >
          <h2 className="text-2xl font-semibold">Grading & conditie</h2>
          <p className="af-muted">
            We gebruiken een grading-schaal die dicht bij de grote platforms
            (zoals Cardmarket) ligt. Twijfel je? Kies liever een stapje lager
            dan hoger – dat voorkomt teleurstellingen en aanpassingen.
          </p>

          <ul className="space-y-2 af-muted">
            <li>
              <strong>NM (Near Mint)</strong> – Kaart oogt vrijwel nieuw. Zeer minimale
              slijtage aan de randen is toegestaan, geen duidelijke krassen of
              whitening.
            </li>
            <li>
              <strong>EX (Excellent / Lightly Played)</strong> – Lichte
              speelsporen, kleine witte puntjes op de randen, eventueel heel
              lichte shuffle-slijtage, maar geen diepe krassen.
            </li>
            <li>
              <strong>GD (Good / Moderately Played)</strong> – Zichtbare
              slijtage: meerdere witte plekken, lichte krassen, lichte
              randbeschadiging mogelijk. Kaart is nog prima speelbaar in een
              sleeve.
            </li>
            <li>
              <strong>PL (Played / Heavily Played)</strong> – Zware slijtage:
              duidelijke krassen, veel whitening, kleine vouwen of edge-damage.
              Nog speelbaar, maar duidelijk “geleefd”.
            </li>
            <li>
              <strong>PO (Poor)</strong> – Ernstige schade: grote vouwen,
              inktschade, waterdamage, scheuren etc. Dit nemen we alleen af als
              het om duurdere kaarten gaat waar vooraf duidelijk over is
              gecommuniceerd.
            </li>
          </ul>

          <p className="af-muted">
            Twijfel je of een kaart EX of GD is? Kies dan bij voorkeur GD. Bij
            grote afwijkingen in grading passen we de buylist aan en krijg je
            altijd eerst een overzicht met de wijzigingen.
          </p>
        </section>

        {/* Betaling & verzenden */}
        <section
          id="betaling-verzenden"
          className="space-y-4 text-sm md:text-base leading-relaxed scroll-mt-24"
        >
          <h2 className="text-2xl font-semibold">Betaling & verzenden</h2>

          <div>
            <h3 className="text-lg font-semibold mb-1">Betaalmethodes</h3>
            <ul className="list-disc pl-5 space-y-1 af-muted">
              <li>
                <strong>Bankoverschrijving (IBAN)</strong> – uitbetaling in EUR
                naar jouw opgegeven IBAN.
              </li>
              <li>
                <strong>PayPal</strong> – uitbetaling naar je PayPal-adres (eventuele
                PayPal-kosten zijn voor de ontvanger, tenzij anders besproken).
              </li>
            </ul>
            <p className="af-muted mt-2">
              Uitbetaling gebeurt doorgaans binnen <strong>1–2 werkdagen</strong>{" "}
              na goedkeuring van de buylist.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-1">Verzenden</h3>
            <p className="af-muted">
              Je kunt kiezen tussen zelf verzenden of een verzendlabel via
              ArcanaFrisia (zie hierboven bij <em>Verzendopties</em>). Zorg
              altijd voor:
            </p>
            <ul className="list-disc pl-5 space-y-1 af-muted mt-1">
              <li>Stevige verpakking (bubbelenvelop of doos)</li>
              <li>Kaarten gebundeld in zakje / team bag</li>
              <li>Tracking bij hogere waardes sterk aanbevolen</li>
              <li>
                Een notitie met je naam, e-mail en buylist-referentie in het
                pakket
              </li>
            </ul>
          </div>
        </section>

        <section
  id="reviews"
  className="space-y-3 text-sm md:text-base leading-relaxed scroll-mt-24"
>
  <h2 className="text-2xl font-semibold">Reviews & vertrouwen</h2>
  <p className="af-muted">
    We verkopen al jaren Magic: the Gathering kaarten via externe platforms.
    Daar kun je onze reviews en beoordelingsscore bekijken voordat je via de
    buylist bij ons verkoopt.
  </p>

  <div className="af-card border border-[var(--border)] rounded-xl bg-[var(--bg2)] p-4">
    <a
      href="https://www.cardmarket.com/en/Magic/Users/ArcanaFrisia"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 text-sm font-medium text-[var(--gold)] hover:underline"
    >
      Bekijk onze Cardmarket-verkoperspagina
    </a>
  </div>
  <div className="af-card border border-[var(--border)] rounded-xl bg-[var(--bg2)] p-4">
    <a
      href="https://www.cardtrader.com/en/users/arcanafrisia"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 text-sm font-medium text-[var(--gold)] hover:underline"
    >
      Bekijk onze Cardtrader-verkoperspagina
    </a>
  </div>
  <div className="af-card border border-[var(--border)] rounded-xl bg-[var(--bg2)] p-4">
    <a
      href="https://www.webwinkelkeur.nl/webshop/Arcana-Frisia_1211185"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 text-sm font-medium text-[var(--gold)] hover:underline"
    >
      Bekijk onze Webwinkelkeur-verkoperspagina
    </a>
  </div>
</section>


        {/* FAQ */}
<section
  id="faq"
  className="space-y-4 text-sm md:text-base leading-relaxed scroll-mt-24"
>
  <h2 className="text-2xl font-semibold mb-2">Veelgestelde vragen (FAQ)</h2>

  <div className="af-panel border border-[var(--border)] rounded-xl bg-[var(--bg2)] divide-y divide-[var(--border)]">
    
    {/* 1. Geldigheid van offerte */}
    <details className="group">
      <summary className="cursor-pointer flex justify-between items-center p-4 font-semibold af-text">
        Hoe lang is mijn buylist-offerte geldig?
        <span className="transition-transform group-open:rotate-180 text-[var(--gold)]">⌄</span>
      </summary>
      <div className="p-4 pt-0 af-muted">
        We vragen je om je kaarten binnen <strong>3 dagen</strong> te verzenden 
        nadat je je buylist hebt ingediend. Zo sluiten prijzen en voorraad het beste aan 
        op de situatie van dat moment.
      </div>
    </details>

    {/* 2. Conditie slechter dan gekozen */}
    <details className="group">
      <summary className="cursor-pointer flex justify-between items-center p-4 font-semibold af-text">
        Wat als mijn kaarten in slechtere conditie zijn dan gekozen?
        <span className="transition-transform group-open:rotate-180 text-[var(--gold)]">⌄</span>
      </summary>
      <div className="p-4 pt-0 af-muted">
        Dan passen we de conditie en bijbehorende payout aan. Je ontvangt altijd 
        een overzicht van eventuele wijzigingen voordat we uitbetalen.
      </div>
    </details>

    {/* 3. Sealed verkopen */}
    <details className="group">
      <summary className="cursor-pointer flex justify-between items-center p-4 font-semibold af-text">
        Kan ik ook sealed producten verkopen?
        <span className="transition-transform group-open:rotate-180 text-[var(--gold)]">⌄</span>
      </summary>
      <div className="p-4 pt-0 af-muted">
        Dat is soms mogelijk, maar niet via de standaard buylist. 
        Mail ons via <strong>info@arcanafrisia.com</strong> met een korte omschrijving 
        en je vraagprijs.
      </div>
    </details>

    {/* 4. Kaart niet op buylist */}
    <details className="group">
      <summary className="cursor-pointer flex justify-between items-center p-4 font-semibold af-text">
        Wat gebeurt er als een kaart niet op de buylist staat?
        <span className="transition-transform group-open:rotate-180 text-[var(--gold)]">⌄</span>
      </summary>
      <div className="p-4 pt-0 af-muted">
        Dan kopen we die kaart op dit moment niet actief in. 
        Heb je een grotere collectie? Dan kunnen we soms een aparte deal maken – 
        stuur ons gerust een bericht.
      </div>
    </details>

    {/* 5. Store credit */}
    <details className="group">
      <summary className="cursor-pointer flex justify-between items-center p-4 font-semibold af-text">
        Kan ik buylist-store credit krijgen in plaats van geld?
        <span className="transition-transform group-open:rotate-180 text-[var(--gold)]">⌄</span>
      </summary>
      <div className="p-4 pt-0 af-muted">
        Op dit moment betalen we uit via bank of PayPal. 
        Store credit of trade-in opties worden mogelijk in de toekomst toegevoegd.
      </div>
    </details>

    {/* 6. sleeves verwijderen */}
    <details className="group">
      <summary className="cursor-pointer flex justify-between items-center p-4 font-semibold af-text">
        Waarom moeten sleeves van de kaarten af?
        <span className="transition-transform group-open:rotate-180 text-[var(--gold)]">⌄</span>
      </summary>
      <div className="p-4 pt-0 af-muted">
        Sleeves vertragen het beoordelingsproces omdat iedere kaart handmatig 
        moet worden uitgepakt. Stuur je kaarten daarom <strong>zonder sleeves</strong> in.
        <br /><br />
        Heb je dure kaarten die je extra wilt beschermen? 
        Plaats ze eventueel <strong>tussen twee sleeves</strong> (geen deck sleeve), zodat 
        we ze soepel kunnen verwijderen zonder schade of vertraging.
      </div>
    </details>

  </div>
</section>



        {/* Bedrijfsgegevens */}
        <section
          id="bedrijfsgegevens"
          className="space-y-3 text-sm md:text-base leading-relaxed scroll-mt-24"
        >
          <h2 className="text-2xl font-semibold">Bedrijfsgegevens</h2>
         

          <div className="af-card rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-4 text-sm af-muted space-y-1">
            <p>
              <strong>Bedrijfsnaam:</strong> ArcanaFrisia
            </p>
            <p>
              <strong>Locatie:</strong> Nederland
            </p>
            <p>
              <strong>E-mail:</strong> info@arcanafrisia.com
            </p>
            <p>
              <strong>KvK-nummer:</strong> NL 81412983
            </p>
            <p>
              <strong>BTW-nummer:</strong> NL003556375B79
            </p>
            <p>
              <strong>IBAN-nummer:</strong> NL79KNAB0604687850
            </p>
          </div>

          
        </section>

        <p className="text-xs af-muted mt-4">
          Tip: check ook je spamfolder als je geen e-mails van ons ziet na het
          indienen van een buylist.
        </p>
      </main>
    </div>
  );
}
