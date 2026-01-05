// src/app/admin/submissions/ItemsEditor.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type ItemRow = {
  id: string;
  cmId: number;
  name: string;
  set: string | null;
  collectorNumber: string | null;
  condition: string;
  isFoil: boolean;
  qty: number;
  unitCents: number;
  lineCents: number;
};

type Variant = {
  cardmarketId: number;
  name: string;
  set: string | null;
  collectorNumber: string | null;
};

type Props = {
  submissionId: string;
  items: ItemRow[];
};

type RowState = ItemRow & {
  dirty?: boolean;
  isNew?: boolean; // client-only for split rows
  variants?: Variant[];
  variantsLoading?: boolean;
  variantsError?: string | null;
};

const euro = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

// Zachtere input styling (minder “hard wit”)
const INPUT =
  "h-7 w-full rounded-md border border-slate-600/70 bg-slate-950/40 text-slate-100 px-2 text-xs " +
  "focus:outline-none focus:ring-2 focus:ring-[#C9A24E]/30 focus:border-[#C9A24E]/60";

const INPUT_NUM =
  "h-7 w-16 rounded-md border border-slate-600/70 bg-slate-950/40 text-slate-100 px-2 text-xs text-right " +
  "focus:outline-none focus:ring-2 focus:ring-[#C9A24E]/30 focus:border-[#C9A24E]/60";

const SELECT =
  "h-7 w-full rounded-md border border-slate-600/70 bg-slate-950/40 text-slate-100 px-2 text-xs " +
  "focus:outline-none focus:ring-2 focus:ring-[#C9A24E]/30 focus:border-[#C9A24E]/60";

const CHECK = "h-4 w-4 accent-[#C9A24E]";

function isNewId(id: string) {
  return id.startsWith("new-");
}

function computePerUnit(lineCents: number, qty: number, unitCents: number) {
  if (qty > 0) return Math.round(lineCents / qty);
  return unitCents ?? 0;
}

export default function ItemsEditor({ submissionId, items }: Props) {
  const router = useRouter();

  const [rows, setRows] = React.useState<RowState[]>(() =>
    (items ?? []).map((r) => ({ ...r, dirty: false }))
  );

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const totalCents = React.useMemo(
    () => rows.reduce((s, r) => s + (Number(r.lineCents) || 0), 0),
    [rows]
  );

  const hasDirty = rows.some((r) => r.dirty);

  function updateRow(id: string, fn: (r: RowState) => RowState) {
    setRows((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
  }

  // Split 1x: maak van qty>=2 één extra regel met qty=1 (client-only new id)
  function splitOne(rowId: string) {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.id === rowId);
      if (i === -1) return prev;

      const r = prev[i];
      const qty = Number(r.qty ?? 0);
      if (qty < 2) return prev;

      const perUnit = computePerUnit(
        Number(r.lineCents ?? 0),
        qty,
        Number(r.unitCents ?? 0)
      );

      const original: RowState = {
        ...r,
        qty: qty - 1,
        lineCents: perUnit * (qty - 1),
        dirty: true,
      };

      const newRow: RowState = {
        ...r,
        id: `new-${crypto.randomUUID()}`,
        qty: 1,
        lineCents: perUnit * 1,
        dirty: true,
        isNew: true,
        // variants state kopiëren is ok (zelfde kaart), maar niet nodig
      };

      const copy = [...prev];
      copy[i] = original;
      copy.splice(i + 1, 0, newRow);
      return copy;
    });
  }

  // ---- Varianten ophalen via /api/prices/search?query=NAME ----
  async function loadVariants(row: RowState) {
    if (row.variants || row.variantsLoading) return;

    updateRow(row.id, (r) => ({
      ...r,
      variantsLoading: true,
      variantsError: null,
    }));

    try {
      const res = await fetch(
        `/api/prices/search?query=${encodeURIComponent(row.name)}`
      );
      const data = await res.json();

      const variants: Variant[] = (data.items ?? [])
        .filter((it: any) => it.cardmarketId != null)
        .map((it: any) => ({
          cardmarketId: Number(it.cardmarketId),
          name: String(it.name),
          set: (it.set as string | null) ?? null,
          collectorNumber: (it.collectorNumber as string | null) ?? null,
        }));

      updateRow(row.id, (r) => ({
        ...r,
        variants,
        variantsLoading: false,
        variantsError: variants.length ? null : "Geen varianten gevonden",
      }));
    } catch (e) {
      console.error(e);
      updateRow(row.id, (r) => ({
        ...r,
        variantsLoading: false,
        variantsError: "Zoeken mislukt",
      }));
    }
  }

  async function handleSave() {
    setError(null);
    setSuccess(null);

    const dirtyRows = rows.filter((r) => r.dirty);
    if (!dirtyRows.length) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/submissions/${submissionId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: dirtyRows.map((r) => ({
            id: r.id,
            qty: Number(r.qty ?? 0), // qty mag 0 zijn
            condition: String(r.condition ?? "NM"),
            isFoil: Boolean(r.isFoil),
            collectorNumber: r.collectorNumber ?? null,
            cmId: Number(r.cmId),
            isNew: Boolean(r.isNew || isNewId(r.id)),
            // (optioneel) hints; mag weg, maar helpt soms
            name: r.name,
            set: r.set,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Opslaan mislukt");
      }

      // Backend contract:
      // data.items = alle items (na opslaan) met echte ids
      // data.createdMap = { "new-...": "realDbId", ... } (als jouw route dit terugstuurt)
      const returned: any[] = Array.isArray(data.items) ? data.items : [];
      const createdMap: Record<string, string> =
        (data.createdMap && typeof data.createdMap === "object"
          ? data.createdMap
          : {}) as any;

      // 1) maak lookup returned by real id
      const returnedById = new Map<string, any>();
      for (const it of returned) {
        if (it?.id) returnedById.set(String(it.id), it);
      }

      // 2) eerst: vervang new- ids -> echte ids (als aanwezig)
      setRows((prev) => {
        const withRealIds = prev.map((r) => {
          const mapped = createdMap[r.id];
          if (mapped) {
            return { ...r, id: String(mapped), isNew: false };
          }
          return r;
        });

        // 3) update rows die nog bestaan; drop rows die backend deleted heeft (qty=0)
        const updated: RowState[] = [];
        const seen = new Set<string>();

        for (const r of withRealIds) {
          const upd = returnedById.get(r.id);
          if (!upd) {
            // bestond niet meer in DB => was verwijderd (qty=0) of unknown => weg uit UI
            continue;
          }

          updated.push({
            ...r,
            id: String(upd.id),
            cmId: Number(upd.cmId ?? r.cmId),
            name: String(upd.name ?? r.name),
            set: (upd.setCode as string | null) ?? (upd.set as string | null) ?? r.set ?? null,
            collectorNumber: (upd.collectorNumber as string | null) ?? null,
            condition: String(upd.condition ?? r.condition),
            isFoil: Boolean(upd.isFoil ?? r.isFoil),
            qty: Number(upd.qty ?? r.qty),
            unitCents: Number(upd.unitCents ?? r.unitCents),
            lineCents: Number(upd.lineCents ?? r.lineCents),
            dirty: false,
            isNew: false,
            // variants/variantsLoading/etc behouden we (handig UX)
            variants: r.variants,
            variantsLoading: r.variantsLoading,
            variantsError: r.variantsError,
          });

          seen.add(String(upd.id));
        }

        // 4) safety: als backend items heeft die wij niet hebben (bijv. create zonder mapping),
        // voeg ze achteraan toe (zeldzaam maar voorkomt “verdwenen split”)
        for (const it of returned) {
          const rid = String(it?.id ?? "");
          if (!rid || seen.has(rid)) continue;

          updated.push({
            id: rid,
            cmId: Number(it.cmId),
            name: String(it.name ?? `#${it.cmId}`),
            set: (it.setCode as string | null) ?? null,
            collectorNumber: (it.collectorNumber as string | null) ?? null,
            condition: String(it.condition ?? "NM"),
            isFoil: Boolean(it.isFoil),
            qty: Number(it.qty ?? 0),
            unitCents: Number(it.unitCents ?? 0),
            lineCents: Number(it.lineCents ?? 0),
            dirty: false,
            isNew: false,
          });
        }

        return updated;
      });

      setSuccess("Wijzigingen opgeslagen.");

      // Belangrijk: server component herladen zodat alles 1:1 klopt (totaal, csv, etc.)
      router.refresh();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Items</h2>

        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-300">
            Totaal (huidig):{" "}
            <span className="font-semibold text-[#C9A24E]">
              {euro(totalCents)}
            </span>
          </span>

          <button
            type="button"
            onClick={handleSave}
            disabled={!hasDirty || saving}
            className="btn-gold inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-semibold shadow hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? "Opslaan…" : "Wijzigingen opslaan"}
          </button>
        </div>
      </div>

      {error && <div className="mb-2 text-xs text-red-400">{error}</div>}
      {success && (
        <div className="mb-2 text-xs text-emerald-400">{success}</div>
      )}

      <div className="rounded-xl border border-slate-700/80 bg-slate-900/50 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-800/70 text-xs">
            <tr>
              <th className="text-left p-2">Kaart</th>
              <th className="text-right p-2 w-20">Qty</th>
              <th className="text-left p-2 w-28">Conditie</th>
              <th className="text-center p-2 w-16">Foil</th>
              <th className="text-left p-2 w-36">Collector #</th>
              <th className="text-center p-2 w-20">Split</th>
              <th className="text-right p-2 w-24">Unit (€)</th>
              <th className="text-right p-2 w-28">Line (€)</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/70">
            {rows.map((row, idx) => (
              <tr
                key={row.id}
                className={[
                  idx % 2 === 0 ? "bg-slate-900/25" : "bg-slate-900/10",
                  "hover:bg-slate-800/45 transition-colors",
                  row.dirty ? "ring-1 ring-inset ring-[#C9A24E]/25" : "",
                ].join(" ")}
              >
                {/* Kaart + variant selector */}
                <td className="p-2 align-top">
                  <div className="text-slate-100">{row.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {row.set ? `[${row.set.toUpperCase()}]` : ""}
                    {row.collectorNumber ? ` #${row.collectorNumber}` : ""}
                    {row.isFoil ? " • Foil" : ""}
                    {` • #${row.cmId}`}
                  </div>

                  <div className="mt-1 flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => loadVariants(row)}
                      className="self-start text-[11px] underline decoration-[#C9A24E]/60 text-slate-200 hover:text-[#C9A24E]"
                    >
                      Versie kiezen
                    </button>

                    {row.variantsLoading && (
                      <div className="text-[11px] text-slate-400">
                        Varianten laden…
                      </div>
                    )}

                    {row.variantsError && (
                      <div className="text-[11px] text-red-400">
                        {row.variantsError}
                      </div>
                    )}

                    {row.variants && row.variants.length > 0 && (
                      <select
                        className={SELECT + " text-[11px]"}
                        value={row.cmId}
                        onChange={(e) => {
                          const newCmId = Number(e.target.value);
                          const v = row.variants!.find(
                            (vv) => vv.cardmarketId === newCmId
                          );
                          updateRow(row.id, (r) => ({
                            ...r,
                            cmId: newCmId,
                            name: v?.name ?? r.name,
                            set: v?.set ?? r.set,
                            collectorNumber:
                              v?.collectorNumber ?? r.collectorNumber,
                            dirty: true,
                          }));
                        }}
                      >
                        {row.variants.map((v) => (
                          <option key={v.cardmarketId} value={v.cardmarketId}>
                            {v.name} [{(v.set ?? "").toUpperCase()}]
                            {v.collectorNumber ? ` #${v.collectorNumber}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </td>

                {/* Qty */}
                <td className="p-2 text-right align-top">
                  <input
                    type="number"
                    min={0}
                    value={row.qty}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      const safe = Number.isFinite(v) && v >= 0 ? v : 0;

                      updateRow(row.id, (r) => {
                        const oldQty = Number(r.qty ?? 0);
                        const perUnit = computePerUnit(
                          Number(r.lineCents ?? 0),
                          oldQty,
                          Number(r.unitCents ?? 0)
                        );
                        const newLine = safe <= 0 ? 0 : perUnit * safe;

                        return {
                          ...r,
                          qty: safe,
                          lineCents: newLine,
                          dirty: true,
                        };
                      });
                    }}
                    className={INPUT_NUM}
                  />
                </td>

                {/* Conditie */}
                <td className="p-2 align-top">
                  <select
                    value={row.condition}
                    onChange={(e) =>
                      updateRow(row.id, (r) => ({
                        ...r,
                        condition: e.target.value,
                        dirty: true,
                      }))
                    }
                    className={SELECT}
                  >
                    <option value="NM">NM</option>
                    <option value="EX">EX</option>
                    <option value="GD">GD</option>
                    <option value="PL">PL</option>
                    <option value="PO">PO</option>
                  </select>
                </td>

                {/* Foil */}
                <td className="p-2 text-center align-top">
                  <input
                    className={CHECK}
                    type="checkbox"
                    checked={row.isFoil}
                    onChange={(e) =>
                      updateRow(row.id, (r) => ({
                        ...r,
                        isFoil: e.target.checked,
                        dirty: true,
                      }))
                    }
                  />
                </td>

                {/* Collector # */}
                <td className="p-2 align-top">
                  <input
                    type="text"
                    value={row.collectorNumber ?? ""}
                    onChange={(e) =>
                      updateRow(row.id, (r) => ({
                        ...r,
                        collectorNumber: e.target.value || null,
                        dirty: true,
                      }))
                    }
                    className={INPUT}
                  />
                </td>

                {/* Split */}
                <td className="p-2 text-center align-top">
                  <button
                    type="button"
                    onClick={() => splitOne(row.id)}
                    disabled={(row.qty ?? 0) < 2}
                    className="text-[11px] underline decoration-[#C9A24E]/60 text-slate-200 hover:text-[#C9A24E] disabled:opacity-40"
                  >
                    Split 1x
                  </button>
                </td>

                {/* Unit */}
                <td className="p-2 text-right align-top tabular-nums">
                  {euro(Number(row.unitCents ?? 0))}
                </td>

                {/* Line */}
                <td className="p-2 text-right align-top tabular-nums">
                  {euro(Number(row.lineCents ?? 0))}
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td className="p-3 text-sm text-slate-300" colSpan={8}>
                  Geen items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        Tip: qty=0 betekent “verwijderen / niet uitbetalen” (backend verwijdert
        de regel bij opslaan).
      </p>
    </div>
  );
}
