// src/lib/buylistPending.ts
import prisma from "@/lib/prisma";

export const PENDING_STATUSES = [
  "SUBMITTED",
  "RECEIVED",
  "GRADING",
  "ADJUSTED",
] as const;

// Map: cardmarketId -> totaal pending qty
export type PendingMap = Map<number, number>;

/**
 * Haalt per CardmarketID de totale pending qty op
 * uit SubmissionItem.productId (die bij jou de cardmarketId bevat),
 * voor alle Submission.status in PENDING_STATUSES.
 */
export async function getPendingQtyByCardmarketId(
  cardmarketIds: number[]
): Promise<PendingMap> {
  const map: PendingMap = new Map();
  if (cardmarketIds.length === 0) return map;

  const productIds = cardmarketIds.map((id) => BigInt(id));

  const rows = await prisma.submissionItem.groupBy({
    by: ["productId"],
    where: {
      productId: { in: productIds },
      Submission: {
        status: { in: [...PENDING_STATUSES] },

      },
    },
    _sum: { qty: true },
  });

  for (const row of rows) {
    const cmId = Number(row.productId); // == cardmarketId
    const qty = row._sum.qty ?? 0;
    map.set(cmId, (map.get(cmId) ?? 0) + qty);
  }

  return map;
}
