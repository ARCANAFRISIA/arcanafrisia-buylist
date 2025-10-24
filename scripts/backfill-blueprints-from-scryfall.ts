// scripts/backfill-blueprints-from-scryfall.ts
import prisma from "../src/lib/prisma";

const BATCH = 2000;

async function pickFoilFromCT(blueprintId: number): Promise<boolean | null> {
  // Modelnaam in Prisma Client: cTMarketSummary  ✅
  const ct = await prisma.cTMarketSummary.findFirst({
    where: { blueprintId },
    orderBy: { snapshotAt: "desc" },
    select: { foil: true },
  });
  return ct?.foil ?? null;
}

async function run() {
  console.log("Backfill BlueprintMapping from Scryfall/CT…");

  let updated = 0;

  while (true) {
    const rows = await prisma.blueprintMapping.findMany({
      where: {
        scryfallId: { not: null },
        OR: [
          { setCode: null },
          { collectorNumber: null },
          { foil: null },
          { cardmarketId: null },
        ],
      },
      select: {
        blueprintId: true,
        scryfallId: true,
        setCode: true,
        collectorNumber: true,
        foil: true,
        cardmarketId: true,
      },
      take: BATCH,
    });

    if (!rows.length) break;

    for (const r of rows) {
      const sf = await prisma.scryfallCard.findUnique({
        where: { id: r.scryfallId! },
        select: { set: true, collectorNumber: true, cardmarketId: true, finishes: true },
      });

      let setCode = r.setCode ?? sf?.set ?? null;
      let collectorNumber = r.collectorNumber ?? sf?.collectorNumber ?? null;

      let foil: boolean | null = r.foil;
      if (foil == null) {
        // 1) Probeer CT
        foil = await pickFoilFromCT(r.blueprintId);
        // 2) Fallback op Scryfall finishes (als eenduidig)
        if (foil == null && sf?.finishes) {
          const fins = sf.finishes;
          if (fins.includes("foil") && !fins.includes("nonfoil")) foil = true;
          else if (fins.includes("nonfoil") && !fins.includes("foil")) foil = false;
        }
      }

      await prisma.blueprintMapping.update({
        where: { blueprintId: r.blueprintId },
        data: {
          setCode: setCode ?? undefined,
          collectorNumber: collectorNumber ?? undefined,
          foil: foil ?? undefined,
          cardmarketId: r.cardmarketId ?? sf?.cardmarketId ?? undefined,
        },
      });

      updated++;
      if (updated % 500 === 0) console.log(`Updated ${updated}…`);
    }
  }

  const totals = {
    total: await prisma.blueprintMapping.count(),
    withSetAndCN: await prisma.blueprintMapping.count({
      where: { setCode: { not: null }, collectorNumber: { not: null } },
    }),
    withFoil: await prisma.blueprintMapping.count({ where: { foil: { not: null } } }),
    withCMid: await prisma.blueprintMapping.count({ where: { cardmarketId: { not: null } } }),
  };

  console.log("Backfill done.", { updated, ...totals });
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
