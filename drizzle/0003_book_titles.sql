ALTER TABLE `volume_editions` ADD `book_title` text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Preserve titles previously entered in the volume label without inventing an order.
UPDATE volume_editions SET book_title=volume_label, volume_label='', volume_sort=NULL
WHERE edition_run_id IN (SELECT id FROM edition_runs WHERE medium='book')
  AND volume_label <> '' AND volume_label GLOB '*[^0-9]*';
