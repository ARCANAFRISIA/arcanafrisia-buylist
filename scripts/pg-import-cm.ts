import fs from "fs";
import path from "path";
import { createGunzip } from "zlib";
import { parse } from "csv-parse";
import prisma from "@/lib/prisma";

/**
 * Verwachte CM Price Guide kolommen (dagelijkse download, CSV of CSV.GZ):
 * idProduct, Avg. Sell Price, Low Price, Trend Price, German Pro Low, Suggested Price,
 * Foil Sell, Foil Low, Foil Trend, Low Price Ex+, AVG1, AVG7, AVG30, Foil AVG1, Foil AVG7, Foil AVG30
 */
async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: ts-node scripts/pg-import-cm.ts <path/to/priceguide.csv[.gz]>");
    process.exit(1);
  }
  const full = path.resolve(inputPath);
  if (!fs.existsSync(full)) {
    console.error("File not found:", full);
    process.exit(1);
  }

  const stream = full.endsWith(".gz")
    ? fs.createReadStream(full).pipe(createGunzip())
    : fs.createReadStream(full);

  const toNum = (v: any): number | null => {
    if (v === undefined || v === null || v === "") return null;
    const s = String(v).replace(",", "."); // EU decimals
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  let ok = 0, skip = 0, err = 0;

  const parser = parse({
    bom: true,
    columns: true,            // headers gebruiken
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });

  parser.on("readable", async () => {
    for (;;) {
      const rec = parser.read() as any;
      if (!rec) break;

      const cmid = Number(rec["idProduct"]);
      if (!Number.isInteger(cmid)) { skip++; continue; }

      const trend     = toNum(rec["Trend Price"]);
      const foilTrend = toNum(rec["Foil Trend"]);
      const low       = toNum(rec["Low Price"]);
      const lowEx     = toNum(rec["Low Price Ex+"]);

      try {
        await prisma.cMPriceGuide.upsert({
          where: { cardmarketId: cmid },
          update: { trend, foilTrend, low, lowEx },
          create: { cardmarketId: cmid, trend, foilTrend, low, lowEx },
        });
        ok++;
      } catch (e) {
        err++;
        console.error("upsert fail:", cmid, e);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    parser.on("end", () => resolve());
    parser.on("error", (e) => reject(e));
    stream.pipe(parser);
  });

  console.log(`Done. ok=${ok} skip=${skip} err=${err}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
