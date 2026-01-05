export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const ALLOWED = new Set(["CORE", "REGULAR", "CTBULK"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  const scryfallId = (body?.scryfallId ?? "").toString();
  const stockClass = (body?.stockClass ?? "").toString().toUpperCase();

  if (!scryfallId || !ALLOWED.has(stockClass)) {
    return NextResponse.json(
      { ok: false, error: "Invalid payload. Need { scryfallId, stockClass }" },
      { status: 400 }
    );
  }

  await prisma.stockPolicy.upsert({
    where: { scryfallId },
    create: { scryfallId, stockClass: stockClass as any },
    update: { stockClass: stockClass as any },
  });

  return NextResponse.json({ ok: true, scryfallId, stockClass });
}
