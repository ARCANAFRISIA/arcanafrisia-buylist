export const dynamic = "force-dynamic";
import { PrismaClient } from "@prisma/client";
import StatusEditor from "../StatusEditor";

const prisma = new PrismaClient();

export default async function Page({ params }: { params: { id: string } }) {
  const submission = await prisma.submission.findUnique({
    where: { id: params.id },
    include: { items: true },
  });

  if (!submission) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-xl font-semibold">Submission niet gevonden</h1>
        <p className="text-sm opacity-70">ID: {params.id}</p>
      </div>
    );
  }

  const totalCents =
    Number(submission.serverTotalCents ?? 0) ||
    submission.items.reduce((s, i) => s + Number(i.lineCents ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Submission {submission.id}</h1>
          <p className="text-sm opacity-70">
            {submission.email ?? "—"} · status: {submission.status}
          </p>
        </div>
        <div className="text-right text-sm">
          <div>Totaal (server): € {(totalCents / 100).toFixed(2)}</div>
          <div className="opacity-70">
            Items: {submission.items.length}
          </div>
        </div>
      </header>

      {/* Status wijzigen + klant notificeren */}
      <section className="rounded-2xl border p-4">
        <h2 className="mb-2 font-semibold">Status & bericht</h2>
        <StatusEditor
          id={submission.id}
          initialStatus={submission.status ?? "RECEIVED"}
        />
      </section>

      {/* Eenvoudige items weergave */}
      <section className="rounded-2xl border p-4">
        <h2 className="mb-2 font-semibold">Items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-2 py-2 text-left">productId</th>
                <th className="px-2 py-2 text-left">Foil</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Unit</th>
                <th className="px-2 py-2 text-right">Line</th>
              </tr>
            </thead>
            <tbody>
              {submission.items.map((i) => (
                <tr key={String(i.id)} className="border-b">
                  <td className="px-2 py-2">#{String(i.productId)}</td>
                  <td className="px-2 py-2">{i.isFoil ? "Foil" : "—"}</td>
                  <td className="px-2 py-2 text-right">{i.qty}</td>
                  <td className="px-2 py-2 text-right">
                    € {((Number(i.unitCents ?? 0)) / 100).toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    € {((Number(i.lineCents ?? 0)) / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
