import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = {
  id: number;
  ctOrderId: number;
  state: string;
  paidAt: Date | null;
  sentAt: Date | null;
  sellerTotalEur: any | null;
  createdAtDb: Date;

  lineCount: bigint;
  missingLocCount: bigint;
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const state = (url.searchParams.get("state") || "").trim(); // optional
    const limit = Math.max(5, Math.min(Number(url.searchParams.get("limit") || "50"), 200));

    // We rekenen "missing location" op basis van:
    // - SalesLog.comment (ctLineId match) of CTOrderLine.commentRaw bevat een locatie token, anders "missing".
    // De echte locatie-resolutie doen we in detail route (incl. inventory fallback).
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        o.id,
        o."ctOrderId",
        o.state,
        o."paidAt",
        o."sentAt",
        o."sellerTotalEur",
        o."createdAtDb",
        COUNT(l.*)::bigint AS "lineCount",
        SUM(
          CASE
            WHEN
              (
                COALESCE(sl.comment, l."commentRaw", '') ~* '(^|\\s|\\|)([A-Z]{1,3}\\d{1,2}\\.\\d{1,2})(\\s|\\||$)'
              )
            THEN 0
            ELSE 1
          END
        )::bigint AS "missingLocCount"
      FROM "CTOrder" o
      JOIN "CTOrderLine" l
        ON l."orderId" = o.id
      LEFT JOIN "SalesLog" sl
        ON sl.source = 'CT'
       AND sl."ctLineId" IS NOT NULL
       AND sl."ctLineId"::bigint = l."ctLineId"::bigint
      WHERE
        (${state} = '' OR o.state = ${state})
      GROUP BY o.id
      ORDER BY o."createdAtDb" DESC
      LIMIT ${limit}
    `;

    const safe = rows.map((r) => ({
      ...r,
      id: Number(r.id),
      ctOrderId: Number(r.ctOrderId),
      lineCount: Number(r.lineCount ?? 0n),
      missingLocCount: Number(r.missingLocCount ?? 0n),
      sellerTotalEur: r.sellerTotalEur == null ? null : Number(r.sellerTotalEur),
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      createdAtDb: r.createdAtDb.toISOString(),
    }));

    return NextResponse.json({ ok: true, items: safe });
  } catch (e: any) {
    console.error("ct orders list error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "ct orders list failed" },
      { status: 500 }
    );
  }
}
