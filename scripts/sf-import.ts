// scripts/sf-import.ts
import { createReadStream } from "fs";
import path from "path";
import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/StreamArray";
import prisma from "../src/lib/prisma";

const filePath = process.argv[2] || "./data/scryfall-default-cards.json";

type SfCard = {
  id: string;
  name: string;
  set: string; // lowercase set code
  collector_number: string;
  finishes?: string[]; // ["nonfoil","foil", ...]
  image_uris?: { small?: string; normal?: string };
  released_at?: string;
  cardmarket_id?: number;
};

type Upsertable = {
  id: string;
  name: string;
  set: string;
  collectorNumber: string;
  finishes: string[];
  imageSmall: string | null;
  imageNormal: string | null;
  releasedAt: Date | null;
  cardmarketId: number | null;
};

async function flushBatch(items: Upsertable[]) {
  if (!items.length) return;
  await prisma.$transaction(
    items.map((it) =>
      prisma.scryfallCard.upsert({
        where: { id: it.id },
        update: it,
        create: it,
      })
    ),
    { timeout: 120000 }
  );
}

async function main() {
  const abs = path.resolve(filePath);
  console.log(`Scryfall import start → ${abs}`);

  let count = 0;
  const batchSize = 500;
  const batch: Upsertable[] = [];

  // async-iterable over het JSON array
  const stream = createReadStream(abs).pipe(parser()).pipe(streamArray());

  for await (const chunk of stream as AsyncIterable<{ key: number; value: SfCard }>) {
    const c = chunk.value;
    if (!c?.id || !c.name || !c.set || !c.collector_number) continue;

    batch.push({
      id: c.id,
      name: c.name,
      set: c.set,
      collectorNumber: c.collector_number,
      finishes: c.finishes ?? [],
      imageSmall: c.image_uris?.small ?? null,
      imageNormal: c.image_uris?.normal ?? null,
      releasedAt: c.released_at ? new Date(c.released_at) : null,
      cardmarketId: c.cardmarket_id ?? null,
    });

    if (batch.length >= batchSize) {
      await flushBatch(batch);
      count += batch.length;
      batch.length = 0;
      if (count % 5000 === 0) console.log(`Upserted ~${count} cards...`);
    }
  }

  if (batch.length) {
    await flushBatch(batch);
    count += batch.length;
  }

  console.log(`Scryfall import DONE. Total upserts: ${count}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
