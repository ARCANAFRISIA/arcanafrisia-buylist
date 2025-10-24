-- Vul ontbrekende setCode, collectorNumber, cardmarketId uit ScryfallCard
UPDATE "BlueprintMapping" bm
SET
  "setCode"         = COALESCE(bm."setCode", sc."set"),
  "collectorNumber" = COALESCE(bm."collectorNumber", sc."collectorNumber"),
  "cardmarketId"    = COALESCE(bm."cardmarketId", sc."cardmarketId")
FROM "ScryfallCard" sc
WHERE bm."scryfallId" = sc."id"
  AND (bm."setCode" IS NULL OR bm."collectorNumber" IS NULL OR bm."cardmarketId" IS NULL);

-- Vul foil op basis van CTMarketSummary (BOOL_OR over alle snapshots)
UPDATE "BlueprintMapping" bm
SET "foil" = agg.foil
FROM (
  SELECT "blueprintId", BOOL_OR(foil) AS foil
  FROM "CTMarketSummary"
  GROUP BY "blueprintId"
) agg
WHERE bm."blueprintId" = agg."blueprintId"
  AND bm."foil" IS NULL;
