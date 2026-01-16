import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

import fs from "fs";
import path from "path";
import readline from "readline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Entry = {
  skuId: number;
  productId: number;
  printing: string | null;
  condition: string | null;
  language: string | null;
};

export async function POST() {
  try {
    const p = path.join(process.cwd(), "src", "data", "tcgplayer_skus_items.ndjson");

    if (!fs.existsSync(p)) {
      return NextResponse.json({ ok: false, error: `missing file: ${p}` }, { status: 400 });
    }

    const stream = fs.createReadStream(p, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const BATCH_LINES = 5000; // safe size for 5 cols bulk insert
    let batch: Entry[] = [];

    let parsed = 0;
    let upserted = 0;
    let badLines = 0;

    async function flush() {
      if (!batch.length) return;

      // ✅ Deduplicate within this flush (last wins)
      const m = new Map<number, Entry>();
      for (const r of batch) m.set(r.skuId, r);
      const unique = Array.from(m.values());
      batch = [];

      const values: any[] = [];
      const rowsSql: string[] = [];

      for (let i = 0; i < unique.length; i++) {
        const r = unique[i];
        const base = i * 5;

        rowsSql.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
        values.push(r.skuId, r.productId, r.condition, r.language, r.printing);
      }

      const sql = `
        INSERT INTO "TcgSkuMap" ("skuId","productId","condition","language","printing")
        VALUES ${rowsSql.join(",")}
        ON CONFLICT ("skuId") DO UPDATE SET
          "productId" = EXCLUDED."productId",
          "condition" = EXCLUDED."condition",
          "language"  = EXCLUDED."language",
          "printing"  = EXCLUDED."printing",
          "updatedAt" = now()
      `;

      // @ts-ignore
      await prisma.$executeRawUnsafe(sql, ...values);

      upserted += unique.length;
    }

    for await (const line of rl) {
      const s = (line ?? "").trim();
      if (!s) continue;

      let obj: any;
      try {
        obj = JSON.parse(s);
      } catch {
        badLines++;
        continue;
      }

      const skuId = Number(obj?.skuId);
      const productId = Number(obj?.productId);

      if (!Number.isFinite(skuId) || !Number.isFinite(productId)) {
        badLines++;
        continue;
      }

      batch.push({
        skuId,
        productId,
        printing: obj?.printing != null ? String(obj.printing) : null,
        condition: obj?.condition != null ? String(obj.condition) : null,
        language: obj?.language != null ? String(obj.language) : null,
      });

      parsed++;

      if (parsed % 50000 === 0) {
        console.log("progress parsed:", parsed, "upserted:", upserted, "bad:", badLines);
      }

      if (batch.length >= BATCH_LINES) {
        await flush();
      }
    }

    await flush();

    return NextResponse.json({
      ok: true,
      file: "tcgplayer_skus_items.ndjson",
      parsed,
      upserted,
      badLines,
    });
  } catch (e: any) {
    console.error("tcg sku import error", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
