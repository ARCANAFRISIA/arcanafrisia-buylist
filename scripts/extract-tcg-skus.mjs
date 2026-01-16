import fs from "fs";
import path from "path";

import StreamJsonPkg from "stream-json";
import PickPkg from "stream-json/filters/Pick.js";
import StreamObjectPkg from "stream-json/streamers/StreamObject.js";

const { parser } = StreamJsonPkg;
const { pick } = PickPkg;
const { streamObject } = StreamObjectPkg;

const inPath = path.join(process.cwd(), "src", "data", "tcgplayer_skus.json");
const outPath = path.join(process.cwd(), "src", "data", "tcgplayer_skus_items.ndjson");

if (!fs.existsSync(inPath)) {
  console.error("Missing input:", inPath);
  process.exit(1);
}

console.log("Reading:", inPath);
console.log("Writing:", outPath);

const out = fs.createWriteStream(outPath, { encoding: "utf8" });

let keysSeen = 0;
let itemsWritten = 0;

const pipeline = fs
  .createReadStream(inPath)
  .pipe(parser())
  .pipe(pick({ filter: "data" }))
  .pipe(streamObject());

pipeline.on("data", (kv) => {
  keysSeen++;

  const arr = kv?.value;
  if (!Array.isArray(arr) || arr.length === 0) return;

  for (const it of arr) {
    const skuId = Number(it?.skuId);
    const productId = Number(it?.productId);
    if (!Number.isFinite(skuId) || !Number.isFinite(productId)) continue;

    const row = {
      skuId,
      productId,
      printing: it?.printing != null ? String(it.printing) : null,
      condition: it?.condition != null ? String(it.condition) : null,
      language: it?.language != null ? String(it.language) : null,
    };

    out.write(JSON.stringify(row) + "\n");
    itemsWritten++;
  }

  if (keysSeen % 2000 === 0) {
    console.log(`progress keys=${keysSeen} items=${itemsWritten}`);
  }
});

pipeline.on("end", () => {
  out.end();
  console.log("DONE keys=", keysSeen, "items=", itemsWritten);
});

pipeline.on("error", (e) => {
  console.error("PIPE ERROR", e);
  try { out.end(); } catch {}
  process.exit(1);
});
