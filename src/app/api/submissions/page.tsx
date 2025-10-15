// ==============================
// File: src/app/submissions/page.tsx
// Purpose: Submissions dashboard (client component)
// ==============================
"use client";
import useSWR from "swr";


const fetcher = (url: string) => fetch(url).then((r) => r.json());


export default function SubmissionsPage() {
const { data, isLoading, error } = useSWR("/api/submissions", fetcher, {
refreshInterval: 0,
});
const rows: any[] = data?.submissions ?? [];


return (
<div className="mx-auto max-w-6xl p-6 space-y-6">
<h1 className="text-2xl font-bold">Submissions</h1>
{isLoading && <div className="opacity-60">Laden…</div>}
{error && (
<div className="rounded-xl bg-red-100 p-3 text-sm text-red-800">
Kon submissions niet laden.
</div>
)}
{!isLoading && rows.length === 0 ? (
<div className="rounded-xl border p-6 text-sm opacity-60">Nog geen submissions.</div>
) : (
<div className="overflow-x-auto rounded-2xl border">
<table className="w-full text-sm">
<thead>
<tr className="border-b bg-gray-50">
<th className="px-3 py-2 text-left">Datum</th>
<th className="px-3 py-2 text-left">Email</th>
<th className="px-3 py-2 text-right">Items</th>
<th className="px-3 py-2 text-right">Qty</th>
</tr>
</thead>
<tbody>
{rows.map((s) => {
const qty = s.items?.reduce((acc: number, it: any) => acc + (it.qty ?? 0), 0) ?? 0;
return (
<tr key={s.id} className="border-b align-top">
<td className="px-3 py-2 whitespace-nowrap">
{new Date(s.createdAt).toLocaleString()}
</td>
<td className="px-3 py-2">{s.email}</td>
<td className="px-3 py-2 text-right">{s.items?.length ?? 0}</td>
<td className="px-3 py-2 text-right tabular-nums">{qty}</td>
</tr>
);
})}
</tbody>
</table>
</div>
)}
</div>
);
}