import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type LineRow = {
  id: number;
  ctLineId: number;

  blueprintId: number | null;
  cardmarketId: number | null;
  scryfallId: string | null;

  isFoil: boolean;
  condition: string | null;
  language: string | null;
  quantity: number;

  unitPriceEur: any;
  lineGrossEur: any;

  commentRaw: string | null;
  saleslogComment: string | null;

  // resolved / enriched:
  resolvedCardmarketId: number | null;

  name: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;

  // location logic:
  locFromComment: string | null;
  locFromInventory: string | null;
};

function extractLocationToken(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;

  // Match: A1.1, B3.6, E01.08, AA12.03 etc.
  const m = s.match(/(^|\s|\|)([A-Z]{1,3}\d{1,2}\.\d{1,2})(\s|\||$)/i);
  if (!m) return null;

  return m[2].toUpperCase();
}


export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ ctOrderId: string }> }
) {
  try {
    const { ctOrderId } = await ctx.params;
    const ctId = Number(ctOrderId);
    if (!ctId || Number.isNaN(ctId)) {
      return NextResponse.json({ ok: false, error: "Invalid ctOrderId" }, { status: 400 });
    }

    const order = await prisma.cTOrder.findUnique({
      where: { ctOrderId: ctId },
      select: {
        id: true,
        ctOrderId: true,
        state: true,
        paidAt: true,
        sentAt: true,
        sellerTotalEur: true,
        shippingEur: true,
        createdAtDb: true,
        updatedAtDb: true,
      },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    // Enrichment strategy:
    // - resolvedCardmarketId: use line.cardmarketId else map blueprintId -> BlueprintMapping.cardmarketId (if exists)
    // - scryfall via ScryfallLookup.cardmarketId
    // - location:
    //    a) extract from SalesLog.comment or CTOrderLine.commentRaw
    //    b) else fallback to first FIFO InventoryLot location for that SKU
    const lines = await prisma.$queryRawUnsafe<LineRow[]>(
      `
      SELECT
        l.id,
        l."ctLineId",
        l."blueprintId",
        l."cardmarketId",
        l."scryfallId",
        l."isFoil",
        l."condition",
        l."language",
        l.quantity,
        l."unitPriceEur",
        l."lineGrossEur",
        l."commentRaw",
        sl.comment AS "saleslogComment",

        COALESCE(l."cardmarketId", bm."cardmarketId") AS "resolvedCardmarketId",

        sf.name AS "name",
        sf."set" AS "setCode",
        sf."collectorNumber" AS "collectorNumber",
        sf."imageSmall" AS "imageUrl",

        NULL::text AS "locFromComment",
        firstlot.location AS "locFromInventory"

      FROM "CTOrderLine" l
      JOIN "CTOrder" o
        ON o.id = l."orderId"

      LEFT JOIN "SalesLog" sl
        ON sl.source = 'CT'
       AND sl."ctLineId" IS NOT NULL
       AND sl."ctLineId"::bigint = l."ctLineId"::bigint

      LEFT JOIN "BlueprintMapping" bm
        ON bm."blueprintId" = l."blueprintId"

      LEFT JOIN "ScryfallLookup" sf
        ON sf."cardmarketId" = COALESCE(l."cardmarketId", bm."cardmarketId")

     LEFT JOIN LATERAL (
  SELECT
    il.location
  FROM "InventoryLot" il
  WHERE il."cardmarketId" = COALESCE(l."cardmarketId", bm."cardmarketId")
    AND il."isFoil" = l."isFoil"
    AND il."qtyRemaining" > 0
    AND (
      l."condition" IS NULL OR il."condition" = l."condition"
    )
    AND (
      l."language" IS NULL OR il."language" = l."language"
    )
  ORDER BY il."sourceDate" ASC, il."createdAt" ASC
  LIMIT 1
) firstlot ON true


      WHERE o."ctOrderId" = $1

      ORDER BY
        sf.name NULLS LAST,
        COALESCE(l."cardmarketId", bm."cardmarketId") NULLS LAST,
        l."isFoil" DESC,
        l."condition" NULLS LAST
      `,
      ctId
    );

    // resolve locFromComment in JS (consistent regex + easy future tweaking)
    const safeLines = lines.map((r) => {
      const loc1 = extractLocationToken(r.saleslogComment);
      const loc2 = extractLocationToken(r.commentRaw);
      const locFromComment = loc1 ?? loc2;

      return {
        id: Number(r.id),
        ctLineId: Number(r.ctLineId),

        blueprintId: r.blueprintId == null ? null : Number(r.blueprintId),
        cardmarketId: r.cardmarketId == null ? null : Number(r.cardmarketId),
        resolvedCardmarketId:
          r.resolvedCardmarketId == null ? null : Number(r.resolvedCardmarketId),
        scryfallId: r.scryfallId ?? null,

        isFoil: !!r.isFoil,
        condition: r.condition ?? null,
        language: r.language ?? null,
        quantity: Number(r.quantity),

        unitPriceEur: r.unitPriceEur == null ? null : Number(r.unitPriceEur),
        lineGrossEur: r.lineGrossEur == null ? null : Number(r.lineGrossEur),

        commentRaw: r.commentRaw ?? null,
        saleslogComment: r.saleslogComment ?? null,

        name: r.name ?? null,
        setCode: r.setCode ?? null,
        collectorNumber: r.collectorNumber ?? null,
        imageUrl: r.imageUrl ?? null,

        locFromComment,
        locFromInventory: r.locFromInventory ? String(r.locFromInventory) : null,

        // final resolved location:
        location: locFromComment ?? (r.locFromInventory ? String(r.locFromInventory) : null),
      };
    });

    const safeOrder = {
      ...order,
      id: Number(order.id),
      ctOrderId: Number(order.ctOrderId),
      sellerTotalEur: order.sellerTotalEur == null ? null : Number(order.sellerTotalEur),
      shippingEur: order.shippingEur == null ? null : Number(order.shippingEur),
      paidAt: order.paidAt ? order.paidAt.toISOString() : null,
      sentAt: order.sentAt ? order.sentAt.toISOString() : null,
      createdAtDb: order.createdAtDb.toISOString(),
      updatedAtDb: order.updatedAtDb.toISOString(),
    };

    return NextResponse.json({ ok: true, order: safeOrder, lines: safeLines });
  } catch (e: any) {
    console.error("ct order detail error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "ct order detail failed" },
      { status: 500 }
    );
  }
}
