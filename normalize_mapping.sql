-- 1) Voeg ontbrekende kolommen in BlueprintMapping toe (add-only, idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='BlueprintMapping' AND column_name='setCode'
  ) THEN
    ALTER TABLE "BlueprintMapping" ADD COLUMN "setCode" text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='BlueprintMapping' AND column_name='collectorNumber'
  ) THEN
    ALTER TABLE "BlueprintMapping" ADD COLUMN "collectorNumber" text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='BlueprintMapping' AND column_name='cardmarketId'
  ) THEN
    ALTER TABLE "BlueprintMapping" ADD COLUMN "cardmarketId" integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='BlueprintMapping' AND column_name='foil'
  ) THEN
    ALTER TABLE "BlueprintMapping" ADD COLUMN "foil" boolean;
  END IF;
END
$$;

-- 2) Backfill setCode/collectorNumber/cardmarketId vanuit ScryfallCard (alleen waar scryfallId bekend is)
UPDATE "BlueprintMapping" bm
SET
  "setCode"         = COALESCE(bm."setCode", sc."set"),
  "collectorNumber" = COALESCE(bm."collectorNumber", sc."collectorNumber"),
  "cardmarketId"    = COALESCE(bm."cardmarketId", sc."cardmarketId")
FROM "ScryfallCard" sc
WHERE bm."scryfallId" = sc."id"
  AND (bm."setCode" IS NULL OR bm."collectorNumber" IS NULL OR bm."cardmarketId" IS NULL);

-- 3) Backfill foil vanuit CTMarketSummary, maar alleen als CTMarketSummary inderdaad een 'foil' kolom heeft
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='CTMarketSummary' AND column_name='foil'
  ) THEN
    UPDATE "BlueprintMapping" bm
    SET "foil" = agg.foil
    FROM (
      SELECT "blueprintId", BOOL_OR(foil) AS foil
      FROM "CTMarketSummary"
      GROUP BY "blueprintId"
    ) agg
    WHERE bm."blueprintId" = agg."blueprintId"
      AND bm."foil" IS NULL;
  END IF;
END
$$;

-- 4) (Optioneel) fallback voor foil via Scryfall finishes
--    Als de kaart uitsluitend foil of uitsluitend nonfoil heeft, kunnen we veilig invullen.
UPDATE "BlueprintMapping" bm
SET "foil" = TRUE
FROM "ScryfallCard" sc
WHERE bm."scryfallId" = sc."id"
  AND bm."foil" IS NULL
  AND ARRAY['foil']::text[] <@ sc."finishes"  -- finishes bevat 'foil'
  AND NOT ('nonfoil' = ANY(sc."finishes"));   -- en GEEN 'nonfoil'

UPDATE "BlueprintMapping" bm
SET "foil" = FALSE
FROM "ScryfallCard" sc
WHERE bm."scryfallId" = sc."id"
  AND bm."foil" IS NULL
  AND ARRAY['nonfoil']::text[] <@ sc."finishes" -- finishes bevat 'nonfoil'
  AND NOT ('foil' = ANY(sc."finishes"));        -- en GEEN 'foil'
