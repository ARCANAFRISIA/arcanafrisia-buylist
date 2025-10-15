// ==============================
// File: src/app/api/submissions/route.ts
// Purpose: GET /api/submissions — list recent submissions (for dashboard)
// ==============================
export const dynamic = "force-dynamic";


import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";


export async function GET() {
try {
const submissions = await prisma.submission.findMany({
orderBy: { createdAt: "desc" },
take: 100,
include: { items: true },
});
return NextResponse.json({ ok: true, submissions });
} catch (e: any) {
return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
}
}