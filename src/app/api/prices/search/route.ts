// src/app/api/prices/search/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { calculatePayout } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = norm(searchParams.get("query") ?? "");
  if (q.length < 2) return NextResponse.json({ items: [] });

  const rows = await prisma.scryfallLookup.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    select: {
      cardmarketId: true,
      scryfallId: true,
      name: true,
      set: true,
      imageSmall: true,
      imageNormal: true,
      rarity: true,
    },
    take: 20,
  });

  const items = await Promise.all(
    rows.map(async (r) => {
      let payoutPreview: number | null = null;
      if (r.cardmarketId != null) {
        try {
          const res = await calculatePayout({ cardmarketId: r.cardmarketId });
          payoutPreview = res.chosenAfterGuards;
        } catch {}
      }
      return {
        id: r.scryfallId,
        name: r.name,
        set: r.set,
        imageSmall: r.imageSmall,
        imageNormal: r.imageNormal,
        cardmarketId: r.cardmarketId ?? null,
        payoutPreview,
        rarity: r.rarity,
      };
    })
  );

  return NextResponse.json({ items });
}