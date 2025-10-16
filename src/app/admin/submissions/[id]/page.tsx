import { PrismaClient } from "@prisma/client";
import StatusEditor from "../StatusEditor";


"use client";
import * as React from "react";

function StatusEditor({ id, initialStatus }: { id: string; initialStatus: string }) {
  const [status, setStatus] = React.useState(initialStatus || "RECEIVED");
  const [message, setMessage] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const options = ["RECEIVED","GRADING","ADJUSTED","APPROVED","REJECTED","PAID"];

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
      // optioneel: toast
    } catch (e:any) {
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
        onChange={(e)=> setStatus(e.target.value)}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <input
        className="border rounded px-2 py-1 text-sm w-64"
        placeholder="Bericht aan klant (optioneel)"
        value={message}
        onChange={(e)=> setMessage(e.target.value)}
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


const prisma = new PrismaClient();

export default async function SubmissionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // 👈 params awaiten

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!submission) return <div className="p-6">Niet gevonden.</div>;

  const subtotalCents =
  (("subtotalCents" in submission) && typeof (submission as any).subtotalCents === "number")
    ? (submission as any).subtotalCents
    : submission.items.reduce((sum, i) => sum + (i.lineCents ?? 0), 0);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Buylist #{submission.id}</h1>

      <div className="space-y-1">
        <p><b>Email:</b> {submission.email}</p>
        <div className="flex items-center gap-2">
          <b>Status:</b>
          <StatusEditor
  id={submission.id}
  initialStatus={submission.status ?? "RECEIVED"}
/>

        </div>
        <p><b>Totaal:</b> €{(subtotalCents / 100).toFixed(2)}</p>
        <p><b>Aangemaakt:</b> {new Date(submission.createdAt).toLocaleString("nl-NL")}</p>
      </div>

      <h2 className="text-xl font-semibold mt-4">Items</h2>
      <table className="min-w-full text-sm border">
        <thead className="bg-gray-100">
          <tr>
            <th className="p-2 text-left">Naam</th>
            <th className="p-2 text-left">Qty</th>
            <th className="p-2 text-left">Unit (€)</th>
            <th className="p-2 text-left">Lijn (€)</th>
          </tr>
        </thead>
        <tbody>
          {submission.items.map((i) => (
            <tr key={i.id} className="border-t">
              <td className="p-2">
  {`CM#${String(i.productId)}${i.isFoil ? " (Foil)" : ""}`}
</td>
              <td className="p-2">{i.qty}</td>
              <td className="p-2">{(Number(i.unitCents ?? 0) / 100).toFixed(2)}</td>
              <td className="p-2">{(Number(i.lineCents ?? 0) / 100).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
