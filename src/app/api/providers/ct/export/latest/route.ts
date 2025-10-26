export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * GET /api/providers/ct/export/latest
 * Query params:
 *  - limit?: number (default 100000, max 500000)
 *  - since?: ISO date string (capturedAt >= since)
 *
 * CSV columns:
 * blueprintId,cardmarketId,scryfallId,bucket,isFoil,medianPrice,minPrice,offerCount,capturedAt
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limitRaw = searchParams.get("limit");
    const sinceRaw = searchParams.get("since");

    let limit = 100_000;
    if (limitRaw) {
      const n = Number(limitRaw);
      if (!Number.isNaN(n)) limit = Math.min(Math.max(1, Math.floor(n)), 500_000);
    }

    const where: any = {};
    if (sinceRaw) {
      const dt = new Date(sinceRaw);
      if (!Number.isNaN(dt.getTime())) {
        where.capturedAt = { gte: dt };
      }
    }

    const rows = await prisma.cTMarketLatest.findMany({
      where,
      orderBy: [{ blueprintId: "asc" }, { bucket: "asc" }, { isFoil: "asc" }],
      take: limit,
      select: {
        blueprintId: true,
        cardmarketId: true,
        scryfallId: true,
        bucket: true,
        isFoil: true,
        medianPrice: true,
        minPrice: true,
        offerCount: true,
        capturedAt: true,
      },
    });

    const header = [
      "blueprintId",
      "cardmarketId",
      "scryfallId",
      "bucket",
      "isFoil",
      "medianPrice",
      "minPrice",
      "offerCount",
      "capturedAt",
    ].join(",");

    const esc = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = rows.map((r) =>
      [
        esc(r.blueprintId),
        esc(r.cardmarketId ?? ""),
        esc(r.scryfallId ?? ""),
        esc(r.bucket ?? ""),
        esc(r.isFoil ? 1 : 0),
        esc(r.medianPrice ?? ""),
        esc(r.minPrice ?? ""),
        esc(r.offerCount ?? ""),
        esc(r.capturedAt.toISOString()),
      ].join(",")
    );

    const body = [header, ...lines].join("\n");

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ct_latest.csv"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (err: any) {
    console.error("[ct-export-latest] error:", err);
    return NextResponse.json(
      { error: "Export failed", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
