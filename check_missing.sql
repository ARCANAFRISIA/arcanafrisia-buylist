SELECT
  COUNT(*) FILTER (WHERE "setCode" IS NULL OR "collectorNumber" IS NULL) AS missing_meta,
  COUNT(*) FILTER (WHERE "foil" IS NULL) AS missing_foil,
  COUNT(*) FILTER (WHERE "cardmarketId" IS NULL) AS missing_cardmarket
FROM "BlueprintMapping";
