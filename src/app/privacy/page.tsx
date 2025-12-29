"use client";

import BuyHeader from "@/components/buy/BuyHeader";

export default function PrivacyPage() {
  return (
    <div
      className="min-h-screen text-slate-200 af-page"
      style={{ background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)" }}
    >
      <BuyHeader />

      <main className="mx-auto max-w-[1200px] px-6 lg:px-12 pt-16 pb-16">
        <h1 className="text-3xl font-bold mb-4">Privacyverklaring</h1>

        <p className="mb-4 text-sm">
          In deze privacyverklaring leggen we uit welke persoonsgegevens wij
          verzamelen en gebruiken in het kader van de Arcana Frisia Buylist
          en met welk doel. We raden je aan deze verklaring zorgvuldig te
          lezen.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">1. Contactgegevens</h2>
        <p className="mb-3 text-sm">
          Arcana Frisia
          <br />
          E-mail:{" "}
          <a
            href="mailto:info@arcanafrisia.com"
            className="af-page-link"
          >
            info@arcanafrisia.com
          </a>
          <br />
          Contactpersoon voor privacyzaken: Hindrik Arendz
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          2. Welke gegevens verwerken wij?
        </h2>
        <p className="mb-3 text-sm">
          Bij gebruik van onze buylist en bij contact met ons kunnen wij de
          volgende gegevens verwerken:
        </p>
        <ul className="list-disc pl-5 mb-3 text-sm">
          <li>Naam en contactgegevens (e-mailadres, adres, woonplaats, land)</li>
          <li>Gegevens over je buylistinzending (kaarten, hoeveelheden, prijzen)</li>
          <li>Betaalgegevens (bankrekeningnummer of PayPal-adres)</li>
          <li>Communicatie met ons (bijvoorbeeld via e-mail)</li>
          <li>Technische gegevens zoals IP-adres en gebruikte browser</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          3. Doeleinden van de verwerking
        </h2>
        <ul className="list-disc pl-5 mb-3 text-sm">
          <li>Het verwerken en afhandelen van buylistinzendingen</li>
          <li>Het uitbetalen van overeengekomen bedragen</li>
          <li>Communicatie over de status van je inzending</li>
          <li>Het verbeteren van onze dienstverlening en website</li>
          <li>Het voldoen aan wettelijke verplichtingen (zoals administratie)</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">4. Rechtsgrond</h2>
        <p className="mb-3 text-sm">
          Wij verwerken persoonsgegevens op basis van de volgende
          rechtsgronden uit de AVG:
        </p>
        <ul className="list-disc pl-5 mb-3 text-sm">
          <li>Uitvoering van een overeenkomst (buylistinzending)</li>
          <li>Toestemming (bijvoorbeeld voor bepaalde cookies of nieuwsbrieven)</li>
          <li>Wettelijke verplichting (fiscale bewaarplicht)</li>
          <li>Gerechtvaardigd belang (bijvoorbeeld fraudepreventie)</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">5. Bewaartermijnen</h2>
        <p className="mb-3 text-sm">
          Wij bewaren je gegevens niet langer dan noodzakelijk is voor de
          doeleinden waarvoor ze zijn verkregen, of zolang dat wettelijk
          verplicht is. Administratieve gegevens bewaren we bijvoorbeeld
          minimaal 7 jaar in verband met fiscale verplichtingen.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">6. Delen van gegevens</h2>
        <p className="mb-3 text-sm">
          Wij verkopen je gegevens niet aan derden. Wel kunnen wij gebruikmaken
          van verwerkers die bepaalde diensten voor ons uitvoeren, zoals
          betalingsverwerking, hosting of reviewverwerking. Met deze partijen
          sluiten wij een verwerkersovereenkomst om jouw gegevens goed te
          beschermen.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">7. Jouw rechten</h2>

        <h3 className="font-semibold mt-4 mb-1 text-sm">
          Recht op inzage (Artikel 15 AVG)
        </h3>
        <p className="mb-2 text-sm">
          Je hebt altijd het recht om de gegevens die wij (laten) verwerken en
          die betrekking hebben op jouw persoon of daartoe herleidbaar zijn, in
          te zien. Je kunt een verzoek met die strekking doen aan onze
          contactpersoon voor privacyzaken. Je ontvangt dan binnen 30 dagen een
          reactie op je verzoek. Als je verzoek wordt ingewilligd sturen wij je
          op het bij ons bekende e-mailadres een kopie van alle gegevens met
          een overzicht van de verwerkers die deze gegevens onder zich hebben,
          onder vermelding van de categorie waaronder wij deze gegevens hebben
          opgeslagen.
        </p>

        <h3 className="font-semibold mt-4 mb-1 text-sm">
          Recht op rectificatie (Artikel 16 AVG)
        </h3>
        <p className="mb-2 text-sm">
          Je hebt altijd het recht om de gegevens die wij (laten) verwerken en
          die betrekking hebben op jouw persoon of daartoe herleidbaar zijn, te
          laten aanpassen. Je kunt een verzoek met die strekking doen aan onze
          contactpersoon voor privacyzaken. Je ontvangt dan binnen 30 dagen een
          reactie op je verzoek. Als je verzoek wordt ingewilligd sturen wij je
          op het bij ons bekende e-mailadres een bevestiging dat de gegevens
          zijn aangepast.
        </p>

        <h3 className="font-semibold mt-4 mb-1 text-sm">
          Recht op beperking van de verwerking (Artikel 18 AVG)
        </h3>
        <p className="mb-2 text-sm">
          Je hebt altijd het recht om de gegevens die wij (laten) verwerken en
          die betrekking hebben op jouw persoon of daartoe herleidbaar zijn, te
          laten beperken. Je kunt een verzoek met die strekking doen aan onze
          contactpersoon voor privacyzaken. Je ontvangt dan binnen 30 dagen een
          reactie op je verzoek. Als je verzoek wordt ingewilligd sturen wij je
          op het bij ons bekende e-mailadres een bevestiging dat de gegevens tot
          je de beperking opheft niet langer worden verwerkt.
        </p>

        <h3 className="font-semibold mt-4 mb-1 text-sm">
          Recht op overdraagbaarheid (Artikel 20 AVG)
        </h3>
        <p className="mb-2 text-sm">
          Je hebt altijd het recht om de gegevens die wij (laten) verwerken en
          die betrekking hebben op jouw persoon of daartoe herleidbaar zijn, 
          door een andere partij te laten uitvoeren. Je kunt een verzoek met die
          strekking doen aan onze contactpersoon voor privacyzaken. Je ontvangt
          dan binnen 30 dagen een reactie op je verzoek. Als je verzoek wordt
          ingewilligd sturen wij je op het bij ons bekende e-mailadres
          afschriften of kopieën van alle gegevens over jou die wij hebben
          verwerkt of in opdracht van ons door andere verwerkers of derden zijn
          verwerkt.
        </p>

        <h3 className="font-semibold mt-4 mb-1 text-sm">
          Recht op bezwaar en andere rechten (Artikelen 21 en 22 AVG)
        </h3>
        <p className="mb-2 text-sm">
          Je hebt in voorkomende gevallen het recht bezwaar te maken tegen de
          verwerking van je persoonsgegevens door of in opdracht van Arcana
          Frisia. Als je bezwaar maakt zullen wij onmiddellijk de
          gegevensverwerking staken in afwachting van de afhandeling van je
          bezwaar. Is je bezwaar gegrond dan zullen wij afschriften en/of
          kopieën van gegevens die wij (laten) verwerken aan je ter beschikking
          stellen en daarna de verwerking blijvend staken.
        </p>
        <p className="mb-3 text-sm">
          Je hebt bovendien het recht om niet aan geautomatiseerde individuele
          besluitvorming of profiling te worden onderworpen. Wij verwerken je
          gegevens niet op zodanige wijze dat dit recht van toepassing is. Ben je
          van mening dat dit wel zo is, neem dan contact op met onze
          contactpersoon voor privacyzaken.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          8. Beoordelingen – WebwinkelKeur
        </h2>
        <p className="mb-3 text-sm">
          Wij verzamelen reviews via het platform van WebwinkelKeur. Als je een
          review achterlaat via WebwinkelKeur ben je verplicht om je naam en
          e-mailadres op te geven. WebwinkelKeur deelt deze gegevens met ons,
          zodat wij de review aan je bestelling of inzending kunnen koppelen.
          WebwinkelKeur publiceert je naam eveneens op de eigen website. In
          sommige gevallen kan WebwinkelKeur contact met je opnemen om een
          toelichting op je review te geven.
        </p>
        <p className="mb-3 text-sm">
          In het geval dat wij je uitnodigen om een review achter te laten delen
          wij je naam en e-mailadres met WebwinkelKeur. Zij gebruiken deze
          gegevens enkel met het doel je uit te nodigen om een review achter te
          laten. WebwinkelKeur heeft passende technische en organisatorische
          maatregelen genomen om je persoonsgegevens te beschermen. Alle hierboven
          genoemde waarborgen met betrekking tot de bescherming van je
          persoonsgegevens zijn eveneens van toepassing op de onderdelen van de
          dienstverlening waarvoor WebwinkelKeur derden inschakelt.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">9. Vragen of klachten</h2>
        <p className="mb-3 text-sm">
          Heb je vragen over deze privacyverklaring of over de verwerking van je
          gegevens, neem dan contact op via{" "}
          <a
            href="mailto:info@arcanafrisia.com"
            className="af-page-link"
          >
            info@arcanafrisia.com
          </a>
          .
        </p>
      </main>
    </div>
  );
}
