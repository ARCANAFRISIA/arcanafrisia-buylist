import { PrismaClient } from "@prisma/client";
import StatusForm from "./StatusForm";

const prisma = new PrismaClient();

export default async function SubmissionDetail({ params }: { params: { id: string } }) {
  const id = params.id; // string CUID

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!submission) return <div className="p-6">Niet gevonden.</div>;

  const totalCents =
    submission.totalCents ??
    submission.items.reduce((sum, i) => sum + Number(i.lineCents ?? 0), 0);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Buylist #{submission.id}</h1>

      <div className="space-y-1">
        <p><b>Email:</b> {submission.email}</p>
        <div className="flex items-center gap-2">
          <b>Status:</b>
          <StatusForm id={submission.id} initialStatus={submission.status} />
        </div>
        <p><b>Totaal:</b> €{(totalCents / 100).toFixed(2)}</p>
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
              <td className="p-2">{i.name}</td>
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
