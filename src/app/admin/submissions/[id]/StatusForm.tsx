"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Canonieke statuses die we ondersteunen in de UI */
type SubmissionStatus = "RECEIVED" | "CONFIRMED" | "PAID";

/** Normaliseer willekeurige string naar geldige status (fallback: RECEIVED) */
const normalize = (s: string): SubmissionStatus =>
  s === "RECEIVED" || s === "CONFIRMED" || s === "PAID" ? s : "RECEIVED";

type Props = {
  id: string;
  /** Krijgen we als string uit Prisma/JSON; we normaliseren ‘m zelf. */
  initialStatus: string;
};

const OPTIONS: SubmissionStatus[] = ["RECEIVED", "CONFIRMED", "PAID"];

export default function StatusForm({ id, initialStatus }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<SubmissionStatus>(normalize(initialStatus));
  const [msg, setMsg] = useState<string | null>(null);

  const onSave = () => {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/submissions/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });

        if (!res.ok) {
          // probeer leesbare error te tonen
          let err = "Opslaan mislukt";
          try {
            const j = await res.json();
            if (typeof j?.error === "string") err = j.error;
          } catch {}
          throw new Error(err);
        }

        setMsg("Status opgeslagen.");
        router.refresh(); // refresh server component
      } catch (e: unknown) {
        setMsg(e instanceof Error ? e.message : "Er ging iets mis.");
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <select
        className="px-2 py-1 rounded border bg-black/40"
        value={status}
        onChange={(e) => setStatus(normalize(e.target.value))}
        disabled={isPending}
      >
        {OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={onSave}
        disabled={isPending}
        className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Opslaan…" : "Opslaan"}
      </button>

      {msg && <span className="text-sm opacity-80">{msg}</span>}
    </div>
  );
}
