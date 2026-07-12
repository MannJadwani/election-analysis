-- Run AFTER `npm run db:push` to enable fast fuzzy name/EPIC search.
-- Trigram GIN indexes make `ILIKE '%term%'` fast across large voter tables.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS voters_name_en_trgm
  ON voters USING gin (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS voters_name_original_trgm
  ON voters USING gin (name_original gin_trgm_ops);
CREATE INDEX IF NOT EXISTS voters_relation_name_en_trgm
  ON voters USING gin (relation_name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS voters_epic_trgm
  ON voters USING gin (epic_id gin_trgm_ops);
