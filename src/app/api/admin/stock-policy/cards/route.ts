export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const set = (searchParams.get("set") || "").toLowerCase().trim();
  const q = (searchParams.get("q") || "").trim();

  if (!set) {
    return NextResponse.json({ ok: false, error: "Missing ?set=" }, { status: 400 });
  }

  const cards = await prisma.scryfallLookup.findMany({
    where: {
      set,
      ...(q
        ? { name: { contains: q, mode: "insensitive" } }
        : {}),
    },
    select: {
      cardmarketId: true,
      scryfallId: true,
      name: true,
      set: true,
      collectorNumber: true,
      rarity: true,
      eur: true,
      tix: true,
      edhrecRank: true,
      gameChanger: true,
      updatedAt: true,
    },
    orderBy: [{ name: "asc" }, { collectorNumber: "asc" }],
    take: 5000,
  });

  const ids = cards.map((c) => c.scryfallId);

  const policies = ids.length
    ? await prisma.stockPolicy.findMany({
        where: { scryfallId: { in: ids } },
        select: { scryfallId: true, stockClass: true },
      })
    : [];

  const map = new Map(policies.map((p) => [p.scryfallId, p.stockClass]));

  return NextResponse.json({
    ok: true,
    set,
    count: cards.length,
    cards: cards.map((c) => ({
      ...c,
      stockClass: map.get(c.scryfallId) ?? "REGULAR",
    })),
  });
}
