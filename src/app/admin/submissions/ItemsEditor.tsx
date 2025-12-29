"use client";

import * as React from "react";

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
  variants?: Variant[];
  variantsLoading?: boolean;
  variantsError?: string | null;
};

const euro = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

export default function ItemsEditor({ submissionId, items }: Props) {
  const [rows, setRows] = React.useState<RowState[]>(() =>
    items.map((r) => ({ ...r, dirty: false }))
  );

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const totalCents = React.useMemo(
    () => rows.reduce((s, r) => s + r.lineCents, 0),
    [rows]
  );

  const hasDirty = rows.some((r) => r.dirty);

  function updateRow(id: string, fn: (r: RowState) => RowState) {
    setRows((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
  }

  // ---- Varianten ophalen (zoals list-upload, maar dan per kaartnaam) ----
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
      const res = await fetch(
        `/api/admin/submissions/${submissionId}/items`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: dirtyRows.map((r) => ({
              id: r.id,
              qty: r.qty,
              condition: r.condition,
              isFoil: r.isFoil,
              collectorNumber: r.collectorNumber ?? null,
              cmId: r.cmId,
            })),
          }),
        }
      );

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Opslaan mislukt");
      }

      const map = new Map<string, any>();
      for (const it of data.items as any[]) {
        map.set(it.id, it);
      }

      setRows((prev) =>
        prev.map((r) => {
          const upd = map.get(r.id);
          if (!upd) return { ...r, dirty: false };

          return {
            ...r,
            cmId: Number(upd.cmId),
            name: String(upd.name),
            set: (upd.set as string | null) ?? null,
            collectorNumber:
              (upd.collectorNumber as string | null) ?? null,
            condition: String(upd.condition ?? r.condition),
            isFoil: Boolean(upd.isFoil),
            qty: Number(upd.qty),
            unitCents: Number(upd.unitCents),
            lineCents: Number(upd.lineCents),
            dirty: false,
          };
        })
      );

      setSuccess("Wijzigingen opgeslagen.");
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Opslaan mislukt");
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
      onClick={handleSave}
      disabled={!hasDirty || saving}
      className="btn-gold inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-semibold shadow hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {saving ? "Opslaan…" : "Wijzigingen opslaan"}
    </button>

        </div>
      </div>

      {error && (
        <div className="mb-2 text-xs text-red-400">{error}</div>
      )}
      {success && (
        <div className="mb-2 text-xs text-emerald-400">{success}</div>
      )}

      <table className="min-w-full text-sm border border-slate-700 bg-slate-900/60">
        <thead className="bg-slate-800 text-xs">
          <tr>
            <th className="text-left p-2">Kaart</th>
            <th className="text-right p-2 w-20">Qty</th>
            <th className="text-left p-2 w-28">Conditie</th>
            <th className="text-center p-2 w-16">Foil</th>
            <th className="text-left p-2 w-32">Collector #</th>
            <th className="text-right p-2 w-24">Unit (€)</th>
            <th className="text-right p-2 w-28">Line (€)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`border-t border-slate-800 text-xs ${
                row.dirty ? "bg-slate-900/80" : ""
              }`}
            >
              {/* Kaart + versie selector */}
              <td className="p-2 align-top">
                <div className="text-slate-100">
                  {row.name}
                </div>
                <div className="text-[11px] text-slate-400">
                  {row.set ? `[${row.set.toUpperCase()}]` : ""}
                  {row.collectorNumber
                    ? ` #${row.collectorNumber}`
                    : ""}
                  {row.isFoil ? " • Foil" : ""}
                  {` • #${row.cmId}`}
                </div>

                <div className="mt-1 flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => loadVariants(row)}
                    className="self-start text-[11px] underline text-sky-300 hover:text-[#C9A24E]"
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
                      className="mt-1 w-full rounded border border-slate-600 bg-slate-900 text-[11px] text-slate-100"
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
                        <option
                          key={v.cardmarketId}
                          value={v.cardmarketId}
                        >
                          {v.name} [{(v.set ?? "").toUpperCase()}]
                          {v.collectorNumber
                            ? ` #${v.collectorNumber}`
                            : ""}
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
                  min={1}
                  value={row.qty}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    const safe = Number.isFinite(v) && v > 0 ? v : 1;

                    updateRow(row.id, (r) => {
                      const oldQty = r.qty || 1;
                      const perUnit =
                        oldQty > 0
                          ? Math.round(r.lineCents / oldQty)
                          : r.unitCents;
                      const newLine = perUnit * safe;

                      return {
                        ...r,
                        qty: safe,
                        lineCents: newLine,
                        dirty: true,
                      };
                    });
                  }}
                  className="w-16 rounded border border-slate-600 bg-slate-900 px-1 text-right text-xs text-slate-100"
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
                  className="w-full rounded border border-slate-600 bg-slate-900 px-1 text-xs text-slate-100"
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
                  className="w-full rounded border border-slate-600 bg-slate-900 px-1 text-xs text-slate-100"
                />
              </td>

              {/* Unit / Line (alleen display; echte herberekening doet backend bij opslaan) */}
              <td className="p-2 text-right align-top">
                {euro(row.unitCents)}
              </td>
              <td className="p-2 text-right align-top">
                {euro(row.lineCents)}
              </td>
            </tr>
          ))}

          {rows.length === 0 && (
            <tr>
              <td className="p-2 text-sm" colSpan={7}>
                Geen items.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
