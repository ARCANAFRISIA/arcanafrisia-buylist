import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date();
  if (!sinceParam) since.setHours(0, 0, 0, 0);

  // 1) haal alle summary rows sinds datum
  const rows = await prisma.cTMarketSummary.findMany({
    where: { capturedAt: { gte: since } },
    orderBy: [{ blueprintId: "asc" }, { isFoil: "asc" }, { bucket: "asc" }],
  });

  // 2) haal mapping voor alle unieke blueprintIds
  const ids = Array.from(new Set(rows.map(r => r.blueprintId)));
  const mapping = await prisma.blueprintMapping.findMany({
    where: { blueprintId: { in: ids } },
    select: { blueprintId: true, cardmarketId: true, scryfallId: true },
  });
  const byBp = new Map(mapping.map(m => [m.blueprintId, m]));

  // 3) schrijf CSV
  const header = [
    "capturedAt","blueprintId","cardmarketId","scryfallId",
    "bucket","isFoil","currency","minPrice","medianPrice","offerCount",
  ];
  const body = rows.map(r => {
    const m = byBp.get(r.blueprintId);
    return [
      r.capturedAt.toISOString(),
      r.blueprintId,
      m?.cardmarketId ?? "",
      m?.scryfallId ?? "",
      r.bucket,
      r.isFoil ? 1 : 0,
      r.currency ?? "EUR",
      r.minPrice ?? "",
      r.medianPrice ?? "",
      r.offerCount ?? 0,
    ].join(",");
  });

  const csv = [header.join(","), ...body].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ct_summary_${
        (sinceParam || new Date().toISOString().slice(0, 10))
      }.csv"`,
    },
  });
}
