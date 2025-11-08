// src/app/api/ops/cursor/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const GET = async (req: NextRequest) => {
  const key = req.nextUrl.searchParams.get("key")!;
  const row = await prisma.syncCursor.findUnique({ where: { key } });
  return NextResponse.json({ key, value: row?.value ?? null });
};

export const POST = async (req: NextRequest) => {
  const { key, value } = await req.json();
  const row = await prisma.syncCursor.upsert({
    where: { key }, create: { key, value }, update: { value }
  });
  return NextResponse.json({ ok: true, key: row.key, value: row.value });
};
