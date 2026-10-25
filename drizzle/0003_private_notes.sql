-- Reviewed additive migration. Drizzle Kit proposes a full collection_items
-- rebuild for the new CHECK; SQLite and D1 accept the same constraint on ADD
-- COLUMN, so existing rows, identities and foreign keys are untouched. Every
-- existing note becomes private; the owner makes individual notes public.
ALTER TABLE "collection_items" ADD COLUMN "notes_private" INTEGER NOT NULL DEFAULT 1 CONSTRAINT "collection_items_check_5" CHECK (notes_private IN (0,1));
