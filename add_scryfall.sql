-- Create ScryfallCard table if it doesn't exist
CREATE TABLE IF NOT EXISTS "ScryfallCard" (
  "id"              text PRIMARY KEY,
  "name"            text NOT NULL,
  "set"             text NOT NULL,
  "collectorNumber" text NOT NULL,
  "finishes"        text[] NOT NULL,
  "imageSmall"      text,
  "imageNormal"     text,
  "releasedAt"      timestamp
);

-- Helpful index for matching (name+set+collectorNumber)
CREATE INDEX IF NOT EXISTS "ScryfallCard_name_set_collectorNumber_idx"
  ON "ScryfallCard" ("name","set","collectorNumber");
