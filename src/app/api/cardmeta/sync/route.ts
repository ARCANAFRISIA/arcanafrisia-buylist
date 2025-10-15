export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchScryfallByCardmarketId } from "@/lib/scryfall";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ids: number[] = Array.isArray(body?.ids) ? body.ids : [];
    if (!ids.length) return NextResponse.json({ ok: false, error: "No ids" }, { status: 400 });

    const products = await prisma.product.findMany({ where: { id: { in: ids.map(BigInt) } } });

    let updated = 0;
    for (const p of products) {
      const meta = await fetchScryfallByCardmarketId(Number(p.id));
      if (!meta) continue;
      await prisma.product.update({
        where: { id: p.id },
        data: {
          name: meta.name || undefined,
          setCode: meta.set || undefined,
          imageUrl: meta.image_uris?.normal || meta.image_uris?.large || undefined,
        } as any,
      });
      updated++;
      await new Promise(r => setTimeout(r, 80)); // vriendelijk voor Scryfall
    }
    return NextResponse.json({ ok: true, updated });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
