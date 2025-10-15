import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
type SubmissionStatus = Prisma.$Enums.SubmissionStatus;

function statusClass(status: SubmissionStatus) {
  switch (status) {
    case "RECEIVED": return "bg-yellow-100 text-yellow-700";
    case "CONFIRMED": return "bg-blue-100 text-blue-700";
    case "PAID":      return "bg-green-100 text-green-700";
    default:          return "bg-gray-100 text-gray-700";
  }
}

export default async function AdminSubmissionsPage() {
  const submissions = await prisma.submission.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: true }, // nodig voor fallback totaal
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Buylist Submissions</h1>

      <table className="min-w-full text-sm border">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left p-2">ID</th>
            <th className="text-left p-2">Email</th>
            <th className="text-left p-2">Items</th>
            <th className="text-left p-2">Totaal (€)</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Datum</th>
            <th className="text-left p-2"></th>
          </tr>
        </thead>
        <tbody>
          {submissions.map((s) => {
            const totalCents =
              s.totalCents ??
              s.items.reduce((sum, i) => sum + Number(i.lineCents ?? 0), 0);

            return (
              <tr key={s.id} className="border-t">
                <td className="p-2">{s.id}</td>
                <td className="p-2">{s.email}</td>
                <td className="p-2">{s.items.length}</td>
                <td className="p-2">{(totalCents / 100).toFixed(2)}</td>
                <td className="p-2">
                  <span className={`px-2 py-1 rounded ${statusClass(s.status)}`}>
                    {s.status}
                  </span>
                </td>
                <td className="p-2">
                  {new Date(s.createdAt as unknown as string).toLocaleString("nl-NL")}
                </td>
                <td className="p-2">
                  <a href={`/admin/submissions/${s.id}`} className="text-blue-600 hover:underline">
                    Details →
                  </a>
                </td>
              </tr>
            );
          })}
          {submissions.length === 0 && (
            <tr><td className="p-2" colSpan={7}>Geen submissions gevonden.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
