-- Reviewed additive migration for the data clean-up queue. Drizzle Kit
-- proposes table rebuilds for the new CHECKs; SQLite and D1 accept the same
-- constraints on ADD COLUMN, so existing rows, identities and foreign keys are
-- untouched. Every flag starts at 0: nothing is marked reviewed yet.
ALTER TABLE "collection_items" ADD COLUMN "date_unknown" INTEGER NOT NULL DEFAULT 0 CONSTRAINT "collection_items_check_6" CHECK (date_unknown IN (0,1));--> statement-breakpoint
ALTER TABLE "volume_editions" ADD COLUMN "cover_unavailable" INTEGER NOT NULL DEFAULT 0 CONSTRAINT "volume_editions_check_3" CHECK (cover_unavailable IN (0,1));--> statement-breakpoint
ALTER TABLE "album_releases" ADD COLUMN "cover_unavailable" INTEGER NOT NULL DEFAULT 0 CONSTRAINT "album_releases_check_3" CHECK (cover_unavailable IN (0,1));
