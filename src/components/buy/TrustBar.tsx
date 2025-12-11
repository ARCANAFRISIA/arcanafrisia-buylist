"use client";

export default function TrustBar() {
  const items = [
    {
      title: "162+ onafhankelijke reviews",
      text: "Geverifieerde beoordelingen via WebwinkelKeur.",
    },
    {
      title: "Snelle uitbetaling",
      text: "Meestal binnen 1–2 werkdagen na goedkeuring.",
    },
    {
      title: "Gratis verzendlabel",
      text: "Vanaf een buylist-totaal van € 150,-.",
    },
    {
      title: "Eerlijke grading",
      text: "We beoordelen kaarten zoals op Cardmarket wordt verwacht.",
    },
  ];

  return (
    <section
      aria-label="Vertrouwen & zekerheden"
      className="mt-6 mb-2 rounded-2xl border border-[var(--border)] bg-[var(--bg2)]/70 px-4 py-4 md:px-6 md:py-5 shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xs">
          <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
            Vertrouwen & zekerheden
          </h2>
          <p className="mt-1 text-xs md:text-sm text-slate-400">
            Veilig je kaarten verkopen met duidelijke voorwaarden, snelle
            uitbetaling en onafhankelijke reviews.
          </p>
        </div>

        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs md:text-sm">
          {items.map((item) => (
            <div
              key={item.title}
              className="rounded-xl bg-black/20 border border-slate-800/70 px-3 py-2.5"
            >
              <div className="text-[11px] font-semibold text-slate-100 mb-1">
                {item.title}
              </div>
              <div className="text-[11px] md:text-[12px] text-slate-400 leading-snug">
                {item.text}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
