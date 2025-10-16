"use client";
import * as React from "react";

type Props = {
  id: string;                  // submission.id
  initialStatus: string;       // submission.status
  onSaved?: (updated: any) => void; // optioneel: rij in parent verversen
};

const OPTIONS = ["RECEIVED","GRADING","ADJUSTED","APPROVED","REJECTED","PAID"];

export default function StatusEditor({ id, initialStatus, onSaved }: Props) {
  const [status, setStatus] = React.useState(initialStatus || "RECEIVED");
  const [message, setMessage] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/submissions/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, message: message.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Opslaan mislukt");
      onSaved?.(data.submission);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <select
        className="border rounded px-2 py-1 text-sm"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        {OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
      </select>

      <input
        className="border rounded px-2 py-1 text-sm w-64"
        placeholder="Bericht aan klant (optioneel)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />

      <button
        onClick={save}
        className="border rounded px-3 py-1 text-sm"
        disabled={saving}
      >
        {saving ? "Opslaan…" : "Opslaan"}
      </button>
    </div>
  );
}
