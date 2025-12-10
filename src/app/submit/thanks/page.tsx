import Link from "next/link";

const GOLD = "#C9A24E";

type ThanksPageProps = {
  searchParams: Promise<{ id?: string }>;
};

export default async function ThanksPage({ searchParams }: ThanksPageProps) {
  const { id = "" } = await searchParams;

  return (
    <div
      className="min-h-screen text-slate-200"
      style={{ background: "linear-gradient(180deg, #050910 0%, #0B1220 100%)" }}
    >
      <main className="mx-auto flex w-full max-w-[900px] flex-col px-6 pb-16 pt-16 lg:px-12">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg2)]/80 p-6 shadow-lg backdrop-blur">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight af-text">
            Bedankt voor je inzending!
          </h1>

          <p className="mt-3 text-sm af-muted">
            We hebben je buylist succesvol ontvangen. Binnen korte tijd ontvang je een bevestigingsmail
            met alle details van je inzending. Controleer ook even je
  spam- of ongewenste mailmap als je niets ziet binnen enkele minuten.
          </p>

          {id && (
            <div className="mt-5 rounded-xl border border-[var(--border)] bg-black/30 px-4 py-3">
              <div className="text-xs uppercase tracking-wide af-muted">
                Referentie
              </div>
              <div className="mt-1 font-mono text-sm font-semibold" style={{ color: GOLD }}>
                {id}
              </div>
              <p className="mt-2 text-xs af-muted">
                Vermeld deze referentie altijd bij vragen over je buylist.
              </p>
            </div>
          )}

          <div className="mt-6 space-y-2 text-sm af-muted">
            <p>
              Volg de instructies in de bevestigingsmail om je kaarten goed verpakt
              naar ons op te sturen. Zodra we je zending hebben ontvangen en gecontroleerd,
              betalen we het afgesproken bedrag uit.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/">
              <button
                className="rounded-full px-4 py-2 text-sm font-semibold"
                style={{ backgroundColor: GOLD, color: "#0A0F1A" }}
              >
                Terug naar buylist
              </button>
            </Link>

            <Link href="/">
              <button className="rounded-full border border-[var(--border)] bg-[var(--bg2)] px-4 py-2 text-sm af-text">
                Terug naar home
              </button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
