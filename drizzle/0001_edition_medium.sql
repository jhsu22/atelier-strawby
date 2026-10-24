-- Reviewed additive migration. Drizzle Kit proposes a full edition_runs rebuild
-- for the new CHECK; SQLite and D1 accept the same constraint on ADD COLUMN, so
-- existing rows, identities and foreign keys are untouched. Existing editions
-- become 'manga'; the owner reclassifies light novels and books in the editor.
ALTER TABLE "edition_runs" ADD COLUMN "medium" TEXT NOT NULL DEFAULT 'manga' CONSTRAINT "edition_runs_check_6" CHECK (medium IN ('manga','light_novel','book'));
