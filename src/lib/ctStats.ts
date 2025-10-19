import { NormalizedOffer } from "./ct";

function median(a: number[]) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type BucketKey = "NM" | "EX" | "GD";

export function summarizeByBucket(offers: NormalizedOffer[], foil: boolean) {
  const rows: { bucket: BucketKey; isFoil: boolean; min?: number|null; med?: number|null; count: number }[] = [];
  (["NM","EX","GD"] as BucketKey[]).forEach(bucket => {
    const prices = offers.filter(o => o.cond===bucket && o.foil===foil).map(o => o.price);
    rows.push({
      bucket, isFoil: foil,
      min: prices.length ? Math.min(...prices) : null,
      med: prices.length ? median(prices) : null,
      count: prices.length
    });
  });
  return rows;
}
