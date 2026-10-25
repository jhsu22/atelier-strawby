import { basename } from 'node:path';
import { parseCsv } from '../../src/domain/normalization/csv.ts';
import { parseAcquiredOn } from '../../src/domain/normalization/dates.ts';
import { newNoteState, resolveNote } from '../../src/domain/normalization/notes.ts';
import { HEADERS, correctRow, editionIdentity } from '../../src/domain/normalization/corrections.ts';
import type { SourceRow } from '../../src/domain/normalization/corrections.ts';
import { deriveTags, TAGS, TAG_RULE_VERSION } from '../../src/domain/normalization/tags.ts';
import { digest, searchKey, stableId } from './identity.ts';
import type { NormalizedCopy, SeedPlan, Value } from './types.ts';

export const MAPPING_VERSION = 'initial-collection-v1';
export const SOURCE_SHA256 = '8e7b935ee024654b715c4e88ac406013105961ef3282aec7e0f88ebb35004a0a';

export function normalizeCsv(input: string, filename = 'initial_collection.csv'): SeedPlan {
  const rows = parseCsv(input);
  const header = rows.shift()?.map(x => x.trim());
  if (!header) throw new Error('CSV has no header');
  const positions = HEADERS.map(name => {
    if (header.filter(x => x === name).length !== 1) throw new Error(`Expected exactly one ${name} header`);
    return header.indexOf(name);
  });
  const sourceSha256 = digest(input);
  const plan: SeedPlan = {
    sourceSha256, sourceFilename: basename(filename), mappingVersion: MAPPING_VERSION,
    batchId: stableId('import', sourceSha256, MAPPING_VERSION), parsedRecords: rows.length,
    copies: [], skipped: [], issues: [], tables: {},
  };
  let notesState = newNoteState();
  for (const [index, cells] of rows.entries()) {
    const number = index + 1;
    const source = Object.fromEntries(HEADERS.map((name, i) => [name, cells[positions[i]!] ?? ''])) as SourceRow;
    const trimmed = Object.fromEntries(HEADERS.map(name => [name, source[name].trim()])) as SourceRow;
    if (HEADERS.every(name => !trimmed[name])) {
      plan.skipped.push({ sourceRecordNumber: number, source, reason: 'blank-or-legend-only' });
      notesState = newNoteState();
      continue;
    }
    if (cells.length !== header.length) {
      plan.issues.push({ code: 'COLUMN_COUNT', severity: 'error', sourceRecords: [number], message: `Expected ${header.length} columns; found ${cells.length}` });
      notesState = newNoteState(); continue;
    }
    const { row, audit } = correctRow(trimmed);
    if (!row.Title || !row.Volume || !row.Author || !row.Publisher || !/^\d+$/.test(row.Volume)
        || !Number.isSafeInteger(Number(row.Volume) * 1000)) {
      plan.issues.push({ code: 'INVALID_COLLECTION_ROW', severity: 'error', sourceRecords: [number], message: 'Expected title, integer volume label, author, and publisher after specified corrections; noncollection text is not silently imported.' });
      notesState = newNoteState(); continue;
    }
    if (audit.some(a => a.status === 'conflict')) {
      plan.issues.push({ code: 'CORRECTION_CONFLICT', severity: 'error', sourceRecords: [number], message: 'A correction matched the title/volume but the source value was neither the expected old value nor the corrected value.' });
    }
    let acquiredOn: string | null;
    try { acquiredOn = parseAcquiredOn(row['Date Acquired']); }
    catch (error) {
      plan.issues.push({ code: 'INVALID_DATE', severity: 'error', sourceRecords: [number], message: String(error) });
      notesState = newNoteState(); continue;
    }
    const { note, warning } = resolveNote(row.Notes, acquiredOn, notesState);
    if (warning) plan.issues.push({ code: warning, severity: 'warning', sourceRecords: [number], message: 'No active note; no immediately preceding resolved note with the same known date.' });
    const identity = editionIdentity(row);
    const ambiguous = /omnibus/i.test(note ?? '');
    const format = ambiguous ? 'unknown' : /collector's edition/i.test(row.Title) ? 'collectors'
      : row.Title === 'Fruits Basket: Illustrations' ? 'artbook'
      : row.Title === 'Project SEKAI Comic Anthology' ? 'anthology' : 'standard';
    const seriesId = stableId('series', identity.canonicalTitle);
    const creatorId = stableId('creator', row.Author);
    const publisherId = stableId('publisher', searchKey(row.Publisher));
    const editionRunId = stableId('run', seriesId, row.Title, identity.language, publisherId, format);
    const numberingKey = String(Number(row.Volume));
    const copy: NormalizedCopy = {
      itemId: stableId('initial-collection-copy', number), sourceRecordNumber: number, source, corrected: row,
      corrections: audit, ...identity, editionTitle: row.Title,
      seriesId, creatorId, publisherId, editionRunId, volumeEditionId: stableId('volume-edition', editionRunId, numberingKey),
      volumeLabel: row.Volume, volumeSort: Number(row.Volume) * 1000, numberingKey, format,
      numberingBasis: ambiguous ? 'source_record' : 'printed', acquiredOn, notes: note, tags: deriveTags(note, row.Title),
    };
    plan.copies.push(copy);
  }
  const warnRows = (code: string, copies: NormalizedCopy[], message: string) => {
    if (copies.length) plan.issues.push({ code, severity: 'warning', sourceRecords: copies.map(c => c.sourceRecordNumber), message });
  };
  warnRows('ASSUMED_LANGUAGE', plan.copies.filter(c => c.languageBasis === 'assumed'), 'EN is a specified default, not verified edition evidence.');
  warnRows('UNKNOWN_ACQUISITION_DATE', plan.copies.filter(c => c.acquiredOn === null), 'Keep missing acquisition dates null.');
  warnRows('AMBIGUOUS_OMNIBUS', plan.copies.filter(c => c.numberingBasis === 'source_record'), 'Preserve each source ownership record; physical packaging/numbering needs confirmation.');
  warnRows('REGIONAL_PUBLISHER_REVIEW', plan.copies.filter(c => c.language === 'KR'), 'Retained the source publisher; the Korean regional publisher is unverified.');
  const groups = Map.groupBy(plan.copies, copy => copy.volumeEditionId);
  for (const copies of groups.values()) if (copies.length > 1) warnRows('REPEATED_PHYSICAL_COPY', copies, 'Repeated bibliographic volume retained as distinct owned copies.');
  plan.tables = normalizedTables(plan);
  return plan;
}

function normalizedTables(plan: SeedPlan) {
  const tables: Record<string, Map<string, Record<string, Value>>> = {};
  const add = (table: string, key: string, row: Record<string, Value>) => {
    const target = tables[table] ??= new Map();
    const previous = target.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error(`Conflicting normalized identity in ${table}: ${key}`);
    target.set(key, row);
  };
  for (const copy of plan.copies) {
    add('publishers', copy.publisherId, { id: copy.publisherId, name: copy.corrected.Publisher, normalized_name: searchKey(copy.corrected.Publisher) });
    add('creators', copy.creatorId, { id: copy.creatorId, display_name: copy.corrected.Author, search_key: searchKey(copy.corrected.Author), kind: copy.corrected.Author === 'Multiple Authors' ? 'collective' : 'person' });
    add('series', copy.seriesId, { id: copy.seriesId, canonical_title: copy.canonicalTitle, sort_title: searchKey(copy.canonicalTitle) });
    add('series_creators', `${copy.seriesId}:${copy.creatorId}`, { series_id: copy.seriesId, creator_id: copy.creatorId, role: 'author', credit_order: 0 });
    const aliasTitle = copy.source.Title.trim();
    if (aliasTitle !== copy.canonicalTitle) {
      const kind = aliasTitle === 'Girls Last Tour' ? 'legacy' : ['Yubisaki to Renren', 'Kaoru Hana wa Rin to Saku'].includes(aliasTitle) ? 'romanized' : 'edition';
      const id = stableId('alias', copy.seriesId, searchKey(aliasTitle), kind);
      add('series_aliases', id, { id, series_id: copy.seriesId, title: aliasTitle, search_key: searchKey(aliasTitle), locale: copy.language, kind });
    }
    add('edition_runs', copy.editionRunId, { id: copy.editionRunId, series_id: copy.seriesId, edition_title: copy.editionTitle, language: copy.language, language_basis: copy.languageBasis, publisher_id: copy.publisherId, format: copy.format, numbering_basis: copy.numberingBasis, numbering_verified: 0 });
    add('volume_editions', copy.volumeEditionId, { id: copy.volumeEditionId, edition_run_id: copy.editionRunId, volume_label: copy.volumeLabel, volume_sort: copy.volumeSort, numbering_key: copy.numberingKey, metadata_state: 'unverified' });
    add('collection_items', copy.itemId, { id: copy.itemId, media_kind: 'manga', acquired_on: copy.acquiredOn, notes: copy.notes, version: 1, import_batch_id: plan.batchId, idempotency_key: `initial-collection:${copy.sourceRecordNumber}` });
    add('volumes', copy.itemId, { item_id: copy.itemId, media_kind: 'manga', volume_edition_id: copy.volumeEditionId });
    for (const slug of copy.tags) {
      const tag = TAGS.find(t => t.slug === slug)!; const id = stableId('tag', slug);
      add('tags', id, { id, slug, label: tag.label, category: tag.category });
      add('item_tags', `${copy.itemId}:${id}`, { item_id: copy.itemId, tag_id: id, source: 'derived', rule_version: TAG_RULE_VERSION });
    }
    const recordId = stableId('import-record', plan.batchId, copy.sourceRecordNumber);
    add('import_records', recordId, { id: recordId, batch_id: plan.batchId, source_record_number: copy.sourceRecordNumber, item_id: copy.itemId,
      source_row_json: JSON.stringify(copy.source), normalization_audit_json: JSON.stringify({ corrections: copy.corrections, languageBasis: copy.languageBasis, notes: copy.notes, acquiredOn: copy.acquiredOn }),
      status: 'imported', issue_codes_json: JSON.stringify(plan.issues.filter(i => i.sourceRecords.includes(copy.sourceRecordNumber)).map(i => i.code)) });
  }
  for (const skipped of plan.skipped) {
    const id = stableId('import-record', plan.batchId, skipped.sourceRecordNumber);
    add('import_records', id, { id, batch_id: plan.batchId, source_record_number: skipped.sourceRecordNumber, item_id: null, source_row_json: JSON.stringify(skipped.source), normalization_audit_json: JSON.stringify({ skipped: skipped.reason }), status: 'skipped', issue_codes_json: '[]' });
  }
  return Object.fromEntries(Object.entries(tables).map(([table, values]) => [table, [...values.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => row)]));
}

export function validationSummary(plan: SeedPlan) {
  const countBy = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map(v => [v, values.filter(x => x === v).length]));
  const copies = plan.copies;
  return {
    sourceSha256: plan.sourceSha256, mappingVersion: plan.mappingVersion,
    parsedSourceRecords: plan.parsedRecords, skippedSourceRecords: plan.skipped,
    physicalCopies: copies.length, uniqueSeries: new Set(copies.map(c => c.seriesId)).size,
    editionRuns: new Set(copies.map(c => c.editionRunId)).size, volumeEditions: new Set(copies.map(c => c.volumeEditionId)).size,
    volumesPerLanguage: countBy(copies.map(c => c.language)),
    publisherDistribution: countBy(copies.map(c => c.corrected.Publisher)),
    datedCopies: copies.filter(c => c.acquiredOn !== null).length,
    undatedCopies: copies.filter(c => c.acquiredOn === null).length,
    distinctAcquisitionDates: new Set(copies.map(c => c.acquiredOn).filter(Boolean)).size,
    acquisitionYears: countBy(copies.map(c => c.acquiredOn?.slice(0, 4) ?? 'unknown')),
    recordsWithNotes: copies.filter(c => c.notes !== null).length,
    correctionOutcomes: copies.flatMap(c => c.corrections.map(a => ({ sourceRecordNumber: c.sourceRecordNumber, ...a }))),
    issues: plan.issues,
  };
}

export function assertImportable(plan: SeedPlan) {
  const errors = plan.issues.filter(issue => issue.severity === 'error');
  if (!plan.copies.length || errors.length) throw new Error(`Import blocked: ${errors.length} source errors, ${plan.copies.length} valid collection records. See validation-summary.json.`);
  if (plan.copies.length + plan.skipped.length !== plan.parsedRecords) throw new Error('Source record accounting mismatch');
  if (plan.sourceSha256 === SOURCE_SHA256) {
    const s = validationSummary(plan);
    if (s.physicalCopies !== 177 || s.uniqueSeries !== 38 || s.datedCopies !== 172 || s.undatedCopies !== 5
        || s.distinctAcquisitionDates !== 55 || s.recordsWithNotes !== 97
        || s.volumesPerLanguage.EN !== 167 || s.volumesPerLanguage.JP !== 9 || s.volumesPerLanguage.KR !== 1) {
      throw new Error('Authoritative source invariants do not match the approved Stage 0 baseline');
    }
  }
}
