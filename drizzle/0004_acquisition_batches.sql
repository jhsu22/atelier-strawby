-- Reviewed additive migration: a new table for copies logged together as one
-- haul, and a nullable link from each copy. Existing rows keep NULL (no haul),
-- so identities, dates and the timeline are unchanged until the owner logs one.
CREATE TABLE `acquisition_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`acquired_on` text,
	`store` text,
	`store_private` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "acquisition_batches_check_1" CHECK(store_private IN (0,1)),
	CONSTRAINT "acquisition_batches_check_2" CHECK(acquired_on IS NULL OR (acquired_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(acquired_on, '+0 days') IS NOT NULL AND date(acquired_on, '+0 days') = acquired_on))
);
--> statement-breakpoint
ALTER TABLE `collection_items` ADD `acquisition_batch_id` text REFERENCES acquisition_batches(id);--> statement-breakpoint
CREATE INDEX `collection_items_acquisition_batch_id_idx` ON `collection_items` (`acquisition_batch_id`);