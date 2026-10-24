export const visibleItems = `collection_items i LEFT JOIN import_batches b ON b.id = i.import_batch_id`;
export const personalScope = `i.is_sample = 0 AND (i.import_batch_id IS NULL OR b.status = 'complete')`;
const mangaJoins = `JOIN volumes v ON v.item_id = i.id
  JOIN volume_editions e ON e.id = v.volume_edition_id
  JOIN edition_runs r ON r.id = e.edition_run_id`;
// The manga record includes light novels; prose books are a separate category.
const mangaOnly = `i.media_kind = 'manga' AND r.medium <> 'book'`;
export const SUMMARY_QUERIES = {
  counts: `SELECT COUNT(*) AS physicalCopies, COUNT(DISTINCT r.series_id) AS uniqueSeries,
    COUNT(i.acquired_on) AS datedCopies, COUNT(*) - COUNT(i.acquired_on) AS undatedCopies,
    COUNT(DISTINCT i.acquired_on) AS distinctAcquisitionDates, COUNT(i.notes) AS recordsWithNotes
    FROM ${visibleItems} ${mangaJoins} WHERE ${personalScope} AND ${mangaOnly}`,
  languages: `SELECT r.language AS label, COUNT(*) AS count FROM ${visibleItems} ${mangaJoins}
    WHERE ${personalScope} AND ${mangaOnly} GROUP BY r.language ORDER BY r.language`,
  publishers: `SELECT COALESCE(p.name, 'Unknown') AS label, COUNT(*) AS count
    FROM ${visibleItems} ${mangaJoins} LEFT JOIN publishers p ON p.id = r.publisher_id
    WHERE ${personalScope} AND ${mangaOnly} GROUP BY p.id ORDER BY count DESC, label`,
  years: `SELECT COALESCE(substr(i.acquired_on, 1, 4), 'unknown') AS label, COUNT(*) AS count
    FROM ${visibleItems} ${mangaJoins} WHERE ${personalScope} AND ${mangaOnly} GROUP BY label ORDER BY label`,
  cds: `SELECT COUNT(*) AS count FROM ${visibleItems} JOIN cds ON cds.item_id = i.id
    WHERE ${personalScope} AND i.media_kind = 'cd'`,
  sampleCds: `SELECT COUNT(*) AS count FROM ${visibleItems} JOIN cds ON cds.item_id = i.id
    WHERE i.is_sample = 1 AND (i.import_batch_id IS NULL OR b.status = 'complete')`,
};
