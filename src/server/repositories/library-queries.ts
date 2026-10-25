import { visibleItems } from "./summary-queries.ts";

const complete = "(i.import_batch_id IS NULL OR b.status = 'complete')";
export const LIBRARY_QUERIES = {
  manga: `SELECT i.id, i.version, i.acquired_on, i.notes, i.notes_private, ab.id AS haul_id, ab.acquired_on AS haul_acquired_on, ab.store AS haul_store, ab.store_private AS haul_store_private, e.cover_asset_id, s.id AS series_id, s.canonical_title,
    r.id AS edition_run_id, r.edition_title, r.language, r.language_basis, r.format, r.numbering_basis, r.medium,
    COALESCE(p.name, 'Unknown publisher') AS publisher, e.volume_label, e.volume_sort, e.isbn13
    FROM ${visibleItems} LEFT JOIN acquisition_batches ab ON ab.id = i.acquisition_batch_id JOIN volumes v ON v.item_id = i.id
    JOIN volume_editions e ON e.id = v.volume_edition_id JOIN edition_runs r ON r.id = e.edition_run_id
    JOIN series s ON s.id = r.series_id LEFT JOIN publishers p ON p.id = r.publisher_id
    WHERE i.is_sample = 0 AND i.media_kind = 'manga' AND ${complete}
    ORDER BY s.sort_title, r.language, r.edition_title, e.volume_sort, i.acquired_on, i.id`,
  authors: `SELECT sc.series_id, c.display_name FROM series_creators sc JOIN creators c ON c.id = sc.creator_id ORDER BY sc.credit_order, c.display_name`,
  aliases: `SELECT series_id, title FROM series_aliases ORDER BY title`,
  tags: `SELECT it.item_id, t.label, it.source, t.category FROM item_tags it JOIN tags t ON t.id = it.tag_id ORDER BY t.label`,
  cds: `SELECT i.id, i.version, i.acquired_on, i.notes, i.notes_private, ab.id AS haul_id, ab.acquired_on AS haul_acquired_on, ab.store AS haul_store, ab.store_private AS haul_store_private, i.is_sample, r.cover_asset_id, r.edition_title, a.id AS album_id, a.title, r.id AS release_id, r.release_date
    FROM ${visibleItems} LEFT JOIN acquisition_batches ab ON ab.id = i.acquisition_batch_id JOIN cds c ON c.item_id = i.id JOIN album_releases r ON r.id = c.release_id
    JOIN albums a ON a.id = r.album_id WHERE i.media_kind = 'cd' AND ${complete} ORDER BY a.sort_title, i.id`,
  artists: `SELECT ac.album_id, c.display_name FROM album_creators ac JOIN creators c ON c.id = ac.creator_id ORDER BY ac.credit_order, c.display_name`,
  labels: `SELECT rl.release_id, l.name, rl.catalog_number FROM release_labels rl JOIN labels l ON l.id = rl.label_id ORDER BY rl.credit_order`,
  media: `SELECT release_id, position, format FROM release_media ORDER BY position`,
  tracks: `SELECT m.release_id, m.position AS medium, t.position, t.title, t.duration_ms FROM tracks t JOIN release_media m ON m.id = t.medium_id ORDER BY m.position, t.position`,
  artwork: `SELECT a.id,a.provider,a.source_url,a.attribution,a.match_scope,v.object_key,v.external_url FROM cover_assets a JOIN cover_variants v ON v.cover_asset_id=a.id WHERE a.status='ready' AND v.variant='original'`,
};
