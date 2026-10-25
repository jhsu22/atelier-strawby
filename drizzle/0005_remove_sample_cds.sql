-- Reviewed data migration: sample CDs are no longer part of the app. Any that
-- were seeded are deleted the same way the editor deletes a copy. The retired
-- is_sample column stays (always 0): dropping it needs a full collection_items
-- rebuild, which this project avoids.
UPDATE collection_state SET revision=revision+1 WHERE EXISTS (SELECT 1 FROM collection_items WHERE is_sample=1);--> statement-breakpoint
UPDATE import_records SET item_id=NULL WHERE item_id IN (SELECT id FROM collection_items WHERE is_sample=1);--> statement-breakpoint
DELETE FROM item_tags WHERE item_id IN (SELECT id FROM collection_items WHERE is_sample=1);--> statement-breakpoint
DELETE FROM volumes WHERE item_id IN (SELECT id FROM collection_items WHERE is_sample=1);--> statement-breakpoint
DELETE FROM cds WHERE item_id IN (SELECT id FROM collection_items WHERE is_sample=1);--> statement-breakpoint
DELETE FROM collection_items WHERE is_sample=1;
