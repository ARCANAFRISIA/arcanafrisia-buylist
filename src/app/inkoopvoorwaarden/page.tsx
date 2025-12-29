"use client";

import BuyHeader from "@/components/buy/BuyHeader";

export default function InkoopvoorwaardenPage() {
  return (
    <div
      className="min-h-screen text-slate-200 af-page"
      style={{ background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)" }}
    >
      <BuyHeader />

      <main className="mx-auto max-w-[1200px] px-6 lg:px-12 pt-16 pb-16">
        <h1 className="text-3xl font-bold mb-4">Inkoopvoorwaarden</h1>
        <p className="mb-4 text-sm">
          Deze inkoopvoorwaarden zijn een aanvulling op onze algemene
          voorwaarden en beschrijven specifiek hoe de Arcana Frisia Buylist
          werkt.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          1. Aanbod via de buylist
        </h2>
        <p className="mb-3 text-sm">
          Via de buylist doe je ons een aanbod om je kaarten te verkopen tegen
          de bedragen die op dat moment getoond worden. Dit aanbod is gebaseerd
          op jouw omschrijving van de kaarten (onder andere aantal en staat).
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          2. Ontvangst en controle
        </h2>
        <ul className="list-disc pl-5 mb-3 text-sm">
          <li>Na je bevestiging ontvang je per e-mail een overzicht.</li>
          <li>
            Je stuurt de kaarten goed verpakt en voldoende gefrankeerd naar ons
            toe. Het risico van verzending ligt bij de afzender, tenzij anders
            overeengekomen.
          </li>
          <li>
            Na ontvangst controleren wij de kaarten op echtheid, staat en
            overeenstemming met het overzicht.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          3. Definitieve prijsbepaling
        </h2>
        <p className="mb-3 text-sm">
          De weergegeven buylistprijzen zijn indicatief. De definitieve
          inkoopprijs wordt bepaald na controle van de kaarten. Bij afwijkingen
          (bijvoorbeeld lagere staat of andere editie) kunnen prijzen worden
          aangepast.
        </p>
        <p className="mb-3 text-sm">
          Indien het totale verschil substantieel is, ontvang je van ons een
          aangepast voorstel. Pas nadat je hiermee akkoord bent, ontstaat een
          definitieve koopovereenkomst voor de betreffende kaarten.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          4. Weigering van kaarten
        </h2>
        <p className="mb-3 text-sm">
          Kaarten kunnen door ons worden geweigerd, bijvoorbeeld bij namaak,
          ernstige beschadiging of wanneer ze substantieel afwijken van wat is
          opgegeven. In dat geval nemen wij contact met je op over de
          afhandeling (bijvoorbeeld terugzenden of vernietiging). Kosten voor
          terugzenden kunnen voor jouw rekening zijn; dit wordt per geval
          afgestemd.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          5. Annuleren van een inzending
        </h2>
        <p className="mb-3 text-sm">
          Zolang wij je kaarten nog niet hebben ontvangen kun je je inzending
          kosteloos annuleren door een e-mail te sturen naar{" "}
          <a
            href="mailto:info@arcanafrisia.com"
            className="af-page-link"
          >
            info@arcanafrisia.com
          </a>
          , onder vermelding van je buylistreferentie. Zodra wij de kaarten
          hebben ontvangen en met de beoordeling zijn gestart, is annuleren niet
          altijd meer mogelijk.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">6. Uitbetaling</h2>
        <ul className="list-disc pl-5 mb-3 text-sm">
          <li>
            Uitbetaling vindt plaats op de door jou opgegeven betaalmethode
            (bijvoorbeeld bankrekening of PayPal).
          </li>
          <li>
            Wij streven ernaar om binnen de op de website vermelde termijn uit
            te betalen nadat je akkoord bent gegaan met het definitieve voorstel.
          </li>
          <li>
            Controleer je gegevens zorgvuldig; wij zijn niet aansprakelijk voor
            uitbetalingen naar een onjuist opgegeven rekening.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          7. Particuliere verkoop, margeregeling en B2B
        </h2>
        <p className="mb-3 text-sm">
          De Arcana Frisia Buylist is primair bedoeld voor verkoop door
          particulieren en voor margegoederen. Door een buylist in te dienen
          verklaar je dat je de kaarten verkoopt zonder dat je over deze
          goederen btw als voorbelasting hebt afgetrokken en dat wij de
          margeregeling mogen toepassen op deze inkoop.
        </p>
        <p className="mb-3 text-sm">
          Ben je ondernemer en verkoop je margegoederen (bijvoorbeeld eigen
          inkoop onder de margeregeling of privécollectie) via de buylist, dan
          geldt dezelfde verklaring: je hebt over deze specifieke goederen geen
          btw in aftrek gebracht. Wil je als onderneming met een reguliere
          btw-factuur aan ons verkopen, neem dan vooraf contact met ons op via{" "}
          <a
            href="mailto:info@arcanafrisia.com"
            className="af-page-link"
          >
            info@arcanafrisia.com
          </a>
          . In dat geval maken we aparte afspraken over prijs en facturatie.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          8. Herkomst van de kaarten
        </h2>
        <p className="mb-3 text-sm">
          Door kaarten aan ons te verkopen verklaar je dat je de rechtmatige
          eigenaar bent en dat de kaarten niet afkomstig zijn uit diefstal,
          verduistering of andere strafbare feiten. Bij een redelijk vermoeden
          van een onrechtmatige herkomst kunnen wij de inkoop weigeren en kan
          melding worden gemaakt bij de bevoegde autoriteiten.
        </p>
      </main>
    </div>
  );
}
