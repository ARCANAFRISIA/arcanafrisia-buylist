"use client";

import BuyHeader from "@/components/buy/BuyHeader";

export default function AlgemeneVoorwaardenPage() {
  return (
    <div
      className="min-h-screen text-slate-200 af-page"
      style={{ background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)" }}
    >
      <BuyHeader />

      <main className="mx-auto max-w-[1200px] px-6 lg:px-12 pt-16 pb-16">
        <h1 className="text-3xl font-bold mb-4">
          Algemene voorwaarden – Arcana Frisia Buylist
        </h1>
        <p className="mb-4 text-sm">
          Deze voorwaarden zijn van toepassing op het gebruik van de Arcana
          Frisia Buylist, ons online platform voor de inkoop van Magic: The
          Gathering kaarten.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">1. Definities</h2>
        <ul className="list-disc pl-5 mb-3 text-sm">
          <li>
            <strong>Arcana Frisia</strong>: de onderneming die via de buylist
            kaarten inkoopt.
          </li>
          <li>
            <strong>Verkoper</strong>: iedere natuurlijke persoon of
            rechtspersoon die kaarten aanbiedt via de buylist.
          </li>
          <li>
            <strong>Buylist</strong>: de online tool op{" "}
            <span className="font-mono text-xs">
              buylist.arcanafrisia.com
            </span>{" "}
            waarmee kaarten verkocht kunnen worden aan Arcana Frisia.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">2. Toepasselijkheid</h2>
        <p className="mb-3 text-sm">
          Door gebruik te maken van de buylist verklaar je kennis te hebben
          genomen van deze voorwaarden en ermee akkoord te gaan. Afwijkingen
          zijn alleen geldig indien deze schriftelijk zijn overeengekomen.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">3. Werking van de buylist</h2>
        <ul className="list-disc pl-5 mb-3 text-sm">
          <li>Je selecteert de kaarten die je wilt verkopen en de aantallen.</li>
          <li>
            De buylist toont een indicatieve inkoopprijs per kaart op basis van
            onze formules.
          </li>
          <li>
            Na bevestiging ontvang je een overzicht per e-mail met een
            referentienummer.
          </li>
          <li>
            Je stuurt de kaarten goed verpakt naar het door ons opgegeven adres,
            binnen de termijnen die op de site worden vermeld.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">4. Prijzen en uitbetaling</h2>
        <ul className="list-disc pl-5 mb-3 text-sm">
          <li>
            De weergegeven prijzen zijn indicatief en gebaseerd op de staat en
            juistheid van de kaarten zoals opgegeven.
          </li>
          <li>
            Na ontvangst beoordelen wij de kaarten en bepalen wij de definitieve
            inkoopprijs. Bij afwijkingen (bijvoorbeeld lagere staat) kan de
            uitbetaling lager uitvallen dan het initiële voorstel.
          </li>
          <li>
            Uitbetaling vindt plaats op de door jou opgegeven betaalmethode
            (bijvoorbeeld bankrekening of PayPal), binnen de op de website
            vermelde termijn nadat je akkoord bent gegaan met het definitieve
            voorstel.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          5. Grading en afwijkingen
        </h2>
        <ul className="list-disc pl-5 mb-3 text-sm">
          <li>
            Wij hanteren onze eigen gradingstandaard, gebaseerd op gangbare
            marktstandaarden voor Magic: The Gathering kaarten.
          </li>
          <li>
            Indien een kaart in een lagere staat verkeert dan opgegeven, kunnen
            wij de prijs bijstellen of de kaart weigeren.
          </li>
          <li>
            In geval van significante afwijkingen nemen wij contact met je op met
            een aangepast voorstel.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          6. Weigering van kaarten
        </h2>
        <p className="mb-3 text-sm">
          Wij behouden ons het recht voor om aangeboden kaarten te weigeren,
          bijvoorbeeld bij namaak, ernstige beschadiging of andere redenen. In
          dat geval nemen wij contact met je op om af te stemmen of de kaarten
          tegen jouw kosten worden teruggestuurd of op een andere manier worden
          afgehandeld (bijvoorbeeld vernietiging).
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">7. Aansprakelijkheid</h2>
        <p className="mb-3 text-sm">
          Wij behandelen jouw kaarten zorgvuldig. Onze aansprakelijkheid is
          beperkt tot de door ons vastgestelde inkoopwaarde van de betreffende
          kaarten, tenzij er sprake is van opzet of grove nalatigheid.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">8. Overmacht</h2>
        <p className="mb-3 text-sm">
          In geval van overmacht, waaronder onder meer wordt verstaan storingen
          in de website, logistieke problemen of andere omstandigheden buiten
          onze macht, kunnen wij onze verplichtingen tijdelijk opschorten.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">9. Toepasselijk recht</h2>
        <p className="mb-3 text-sm">
          Op deze voorwaarden en op alle transacties via de buylist is
          uitsluitend Nederlands recht van toepassing. Geschillen zullen bij
          uitsluiting worden voorgelegd aan de bevoegde rechter in Nederland,
          tenzij dwingend recht anders voorschrijft.
        </p>
      </main>
    </div>
  );
}
