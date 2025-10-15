"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SubmissionStatus } from "@prisma/client";

type Props = {
  id: string;
  initialStatus: SubmissionStatus;
};

const options: SubmissionStatus[] = ["RECEIVED", "CONFIRMED", "PAID"];

export default function StatusForm({ id, initialStatus }: Props) {
  const [status, setStatus] = useState<SubmissionStatus>(initialStatus);
  const [saving, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

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
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || "Opslaan mislukt");
        }
        setMsg("Status opgeslagen.");
        router.refresh(); // server component refresh
      } catch (e: any) {
        setMsg(e.message || "Er ging iets mis.");
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <select
        className="px-2 py-1 rounded border bg-black/40"
        value={status}
        onChange={(e) => setStatus(e.target.value as SubmissionStatus)}
        disabled={saving}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>

      <button
        onClick={onSave}
        disabled={saving}
        className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Opslaan…" : "Opslaan"}
      </button>

      {msg && <span className="text-sm opacity-80">{msg}</span>}
    </div>
  );
}
