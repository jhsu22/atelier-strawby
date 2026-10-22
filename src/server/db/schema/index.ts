import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, primaryKey, foreignKey, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';

export const coverAssets = sqliteTable("cover_assets", {
  id: text("id").primaryKey().notNull(),
  provider: text("provider").notNull(),
  sourceUrl: text("source_url"),
  sourceRecordId: text("source_record_id"),
  storageMode: text("storage_mode", { enum: ['r2', 'external'] }).notNull(),
  status: text("status", { enum: ['pending', 'ready', 'missing', 'failed'] }).notNull(),
  matchScope: text("match_scope", { enum: ['edition', 'representative'] }).notNull(),
  sourceLanguage: text("source_language"),
  fetchedAt: text("fetched_at"),
  retryAfter: text("retry_after"),
  lastErrorCode: text("last_error_code"),
  policyVersion: text("policy_version").notNull(),
  attribution: text("attribution"),
  isOwnerSelected: integer("is_owner_selected").notNull().default(sql`0`),
}, () => [
  check("cover_assets_check_1", sql`storage_mode IN ('r2','external')`),
  check("cover_assets_check_2", sql`status IN ('pending','ready','missing','failed')`),
  check("cover_assets_check_3", sql`match_scope IN ('edition','representative')`),
  check("cover_assets_check_4", sql`source_language IS NULL OR source_language IN ('EN','JP','KR')`),
  check("cover_assets_check_5", sql`is_owner_selected IN (0,1)`)
]);

export const coverVariants = sqliteTable("cover_variants", {
  id: text("id").primaryKey().notNull(),
  coverAssetId: text("cover_asset_id").notNull().references(() => coverAssets.id),
  variant: text("variant", { enum: ['grid', 'detail', 'original'] }).notNull(),
  objectKey: text("object_key"),
  externalUrl: text("external_url"),
  sha256: text("sha256"),
  mimeType: text("mime_type").notNull(),
  width: integer("width"),
  height: integer("height"),
  byteSize: integer("byte_size"),
  etag: text("etag"),
}, (t) => [
  check("cover_variants_check_1", sql`variant IN ('grid','detail','original')`),
  check("cover_variants_check_2", sql`(object_key IS NOT NULL) + (external_url IS NOT NULL) = 1`),
  check("cover_variants_check_3", sql`width IS NULL OR width > 0`),
  check("cover_variants_check_4", sql`height IS NULL OR height > 0`),
  check("cover_variants_check_5", sql`byte_size IS NULL OR byte_size > 0`),
  uniqueIndex("cover_variants_cover_asset_id_variant_uq").on(t.coverAssetId, t.variant)
]);

export const creators = sqliteTable("creators", {
  id: text("id").primaryKey().notNull(),
  displayName: text("display_name").notNull(),
  searchKey: text("search_key").notNull(),
  kind: text("kind", { enum: ['person', 'group', 'collective', 'unknown'] }).notNull(),
}, (t) => [
  check("creators_check_1", sql`kind IN ('person','group','collective','unknown')`),
  index("creators_search_key_idx").on(t.searchKey)
]);

export const publishers = sqliteTable("publishers", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
}, (t) => [
  uniqueIndex("publishers_normalized_name_uq").on(t.normalizedName)
]);

export const labels = sqliteTable("labels", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
}, (t) => [
  uniqueIndex("labels_normalized_name_uq").on(t.normalizedName)
]);

export const series = sqliteTable("series", {
  id: text("id").primaryKey().notNull(),
  canonicalTitle: text("canonical_title").notNull(),
  sortTitle: text("sort_title").notNull(),
  description: text("description"),
  representativeCoverId: text("representative_cover_id").references(() => coverAssets.id),
}, (t) => [
  index("series_sort_title_idx").on(t.sortTitle),
  index("series_representative_cover_id_idx").on(t.representativeCoverId)
]);

export const seriesAliases = sqliteTable("series_aliases", {
  id: text("id").primaryKey().notNull(),
  seriesId: text("series_id").notNull().references(() => series.id),
  title: text("title").notNull(),
  searchKey: text("search_key").notNull(),
  locale: text("locale"),
  kind: text("kind", { enum: ['native', 'romanized', 'edition', 'legacy'] }).notNull(),
}, (t) => [
  check("series_aliases_check_1", sql`kind IN ('native','romanized','edition','legacy')`),
  uniqueIndex("series_aliases_series_id_search_key_kind_uq").on(t.seriesId, t.searchKey, t.kind),
  index("series_aliases_search_key_idx").on(t.searchKey)
]);

export const seriesCreators = sqliteTable("series_creators", {
  seriesId: text("series_id").notNull().references(() => series.id),
  creatorId: text("creator_id").notNull().references(() => creators.id),
  role: text("role").notNull(),
  creditOrder: integer("credit_order").notNull(),
}, (t) => [
  check("series_creators_check_1", sql`credit_order >= 0`),
  primaryKey({ columns: [t.seriesId, t.creatorId, t.role] }),
  index("series_creators_creator_id_idx").on(t.creatorId)
]);

export const editionRuns = sqliteTable("edition_runs", {
  id: text("id").primaryKey().notNull(),
  seriesId: text("series_id").notNull().references(() => series.id),
  editionTitle: text("edition_title").notNull(),
  language: text("language", { enum: ['EN', 'JP', 'KR'] }).notNull(),
  languageBasis: text("language_basis", { enum: ['specified', 'assumed', 'confirmed'] }).notNull(),
  publisherId: text("publisher_id").references(() => publishers.id),
  format: text("format", { enum: ['standard', 'omnibus', 'collectors', 'artbook', 'anthology', 'unknown'] }).notNull(),
  numberingBasis: text("numbering_basis", { enum: ['printed', 'source_record', 'unknown'] }).notNull(),
  numberingVerified: integer("numbering_verified").notNull().default(sql`0`),
}, (t) => [
  check("edition_runs_check_1", sql`language IN ('EN','JP','KR')`),
  check("edition_runs_check_2", sql`language_basis IN ('specified','assumed','confirmed')`),
  check("edition_runs_check_3", sql`format IN ('standard','omnibus','collectors','artbook','anthology','unknown')`),
  check("edition_runs_check_4", sql`numbering_basis IN ('printed','source_record','unknown')`),
  check("edition_runs_check_5", sql`numbering_verified IN (0,1)`),
  index("edition_runs_series_id_language_publisher_id_idx").on(t.seriesId, t.language, t.publisherId),
  index("edition_runs_publisher_id_idx").on(t.publisherId)
]);

export const volumeEditions = sqliteTable("volume_editions", {
  id: text("id").primaryKey().notNull(),
  editionRunId: text("edition_run_id").notNull().references(() => editionRuns.id),
  volumeLabel: text("volume_label").notNull(),
  volumeSort: integer("volume_sort"),
  numberingKey: text("numbering_key").notNull(),
  isbn13: text("isbn13"),
  coverAssetId: text("cover_asset_id").references(() => coverAssets.id),
  metadataState: text("metadata_state", { enum: ['unverified', 'partial', 'confirmed'] }).notNull().default(sql`'unverified'`),
}, (t) => [
  check("volume_editions_check_1", sql`metadata_state IN ('unverified','partial','confirmed')`),
  check("volume_editions_check_2", sql`isbn13 IS NULL OR (length(isbn13) = 13 AND isbn13 NOT GLOB '*[^0-9]*')`),
  uniqueIndex("volume_editions_edition_run_id_numbering_key_uq").on(t.editionRunId, t.numberingKey),
  index("volume_editions_edition_run_id_volume_sort_idx").on(t.editionRunId, t.volumeSort),
  index("volume_editions_cover_asset_id_idx").on(t.coverAssetId),
  uniqueIndex("volume_editions_confirmed_isbn_uq").on(t.isbn13).where(sql`isbn13 IS NOT NULL AND metadata_state = 'confirmed'`)
]);

export const albums = sqliteTable("albums", {
  id: text("id").primaryKey().notNull(),
  title: text("title").notNull(),
  sortTitle: text("sort_title").notNull(),
  description: text("description"),
}, (t) => [
  index("albums_sort_title_idx").on(t.sortTitle)
]);

export const albumCreators = sqliteTable("album_creators", {
  albumId: text("album_id").notNull().references(() => albums.id),
  creatorId: text("creator_id").notNull().references(() => creators.id),
  role: text("role").notNull(),
  creditOrder: integer("credit_order").notNull(),
  creditedAs: text("credited_as"),
  joinPhrase: text("join_phrase"),
}, (t) => [
  check("album_creators_check_1", sql`credit_order >= 0`),
  primaryKey({ columns: [t.albumId, t.creatorId, t.role] }),
  index("album_creators_creator_id_idx").on(t.creatorId)
]);

export const albumReleases = sqliteTable("album_releases", {
  id: text("id").primaryKey().notNull(),
  albumId: text("album_id").notNull().references(() => albums.id),
  editionTitle: text("edition_title"),
  releaseDate: text("release_date"),
  datePrecision: text("date_precision"),
  countryCode: text("country_code"),
  editionDescription: text("edition_description"),
  barcode: text("barcode"),
  coverAssetId: text("cover_asset_id").references(() => coverAssets.id),
  metadataState: text("metadata_state", { enum: ['unverified', 'partial', 'confirmed'] }).notNull().default(sql`'unverified'`),
}, (t) => [
  check("album_releases_check_1", sql`metadata_state IN ('unverified','partial','confirmed')`),
  check("album_releases_check_2", sql`(release_date IS NULL AND date_precision IS NULL) OR (release_date IS NOT NULL AND date_precision IS NOT NULL AND ((date_precision = 'year' AND release_date GLOB '[0-9][0-9][0-9][0-9]') OR (date_precision = 'month' AND release_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]') OR (date_precision = 'day' AND release_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')))`),
  index("album_releases_barcode_idx").on(t.barcode),
  index("album_releases_album_id_idx").on(t.albumId),
  index("album_releases_cover_asset_id_idx").on(t.coverAssetId)
]);

export const releaseLabels = sqliteTable("release_labels", {
  id: text("id").primaryKey().notNull(),
  releaseId: text("release_id").notNull().references(() => albumReleases.id),
  labelId: text("label_id").notNull().references(() => labels.id),
  catalogNumber: text("catalog_number"),
  creditOrder: integer("credit_order").notNull(),
}, (t) => [
  check("release_labels_check_1", sql`credit_order >= 0`),
  uniqueIndex("release_labels_release_id_label_id_catalog_number_uq").on(t.releaseId, t.labelId, t.catalogNumber),
  index("release_labels_label_id_catalog_number_idx").on(t.labelId, t.catalogNumber)
]);

export const releaseMedia = sqliteTable("release_media", {
  id: text("id").primaryKey().notNull(),
  releaseId: text("release_id").notNull().references(() => albumReleases.id),
  position: integer("position").notNull(),
  format: text("format", { enum: ['CD', 'Blu-ray', 'DVD', 'other'] }).notNull(),
  title: text("title"),
}, (t) => [
  check("release_media_check_1", sql`position > 0`),
  check("release_media_check_2", sql`format IN ('CD','Blu-ray','DVD','other')`),
  uniqueIndex("release_media_release_id_position_uq").on(t.releaseId, t.position)
]);

export const tracks = sqliteTable("tracks", {
  id: text("id").primaryKey().notNull(),
  mediumId: text("medium_id").notNull().references(() => releaseMedia.id),
  position: integer("position").notNull(),
  printedNumber: text("printed_number"),
  title: text("title").notNull(),
  durationMs: integer("duration_ms"),
  recordingMbid: text("recording_mbid"),
}, (t) => [
  check("tracks_check_1", sql`position > 0`),
  check("tracks_check_2", sql`duration_ms IS NULL OR duration_ms >= 0`),
  uniqueIndex("tracks_medium_id_position_uq").on(t.mediumId, t.position)
]);

export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey().notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceFilename: text("source_filename").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  mappingVersion: text("mapping_version").notNull(),
  status: text("status", { enum: ['preview', 'committing', 'complete', 'failed'] }).notNull(),
  previewRevision: integer("preview_revision"),
  errorSummary: text("error_summary"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  check("import_batches_check_1", sql`status IN ('preview','committing','complete','failed')`),
  uniqueIndex("import_batches_source_kind_source_sha256_mapping_version_uq").on(t.sourceKind, t.sourceSha256, t.mappingVersion),
  uniqueIndex("import_batches_initial_source_uq").on(t.sourceKind).where(sql`source_kind = 'initial-collection'`)
]);

export const collectionItems = sqliteTable("collection_items", {
  id: text("id").primaryKey().notNull(),
  mediaKind: text("media_kind", { enum: ['manga', 'cd'] }).notNull(),
  acquiredOn: text("acquired_on"),
  notes: text("notes"),
  isSample: integer("is_sample").notNull().default(sql`0`),
  version: integer("version").notNull().default(sql`1`),
  importBatchId: text("import_batch_id").references(() => importBatches.id),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  check("collection_items_check_1", sql`media_kind IN ('manga','cd')`),
  check("collection_items_check_2", sql`is_sample IN (0,1)`),
  check("collection_items_check_3", sql`version >= 1`),
  check("collection_items_check_4", sql`acquired_on IS NULL OR (acquired_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(acquired_on, '+0 days') IS NOT NULL AND date(acquired_on, '+0 days') = acquired_on)`),
  uniqueIndex("collection_items_id_media_kind_uq").on(t.id, t.mediaKind),
  uniqueIndex("collection_items_idempotency_key_uq").on(t.idempotencyKey),
  index("collection_items_is_sample_media_kind_acquired_on_idx").on(t.isSample, t.mediaKind, t.acquiredOn),
  index("collection_items_import_batch_id_idx").on(t.importBatchId)
]);

export const volumes = sqliteTable("volumes", {
  itemId: text("item_id").primaryKey().notNull(),
  mediaKind: text("media_kind").notNull().default(sql`'manga'`),
  volumeEditionId: text("volume_edition_id").notNull().references(() => volumeEditions.id),
}, (t) => [
  check("volumes_check_1", sql`media_kind = 'manga'`),
  foreignKey({ columns: [t.itemId, t.mediaKind], foreignColumns: [collectionItems.id, collectionItems.mediaKind] }),
  index("volumes_volume_edition_id_idx").on(t.volumeEditionId)
]);

export const cds = sqliteTable("cds", {
  itemId: text("item_id").primaryKey().notNull(),
  mediaKind: text("media_kind").notNull().default(sql`'cd'`),
  releaseId: text("release_id").notNull().references(() => albumReleases.id),
}, (t) => [
  check("cds_check_1", sql`media_kind = 'cd'`),
  foreignKey({ columns: [t.itemId, t.mediaKind], foreignColumns: [collectionItems.id, collectionItems.mediaKind] }),
  index("cds_release_id_idx").on(t.releaseId)
]);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey().notNull(),
  slug: text("slug").notNull(),
  label: text("label").notNull(),
  category: text("category", { enum: ['memory', 'edition'] }).notNull(),
}, (t) => [
  check("tags_check_1", sql`category IN ('memory','edition')`),
  uniqueIndex("tags_slug_uq").on(t.slug)
]);

export const itemTags = sqliteTable("item_tags", {
  itemId: text("item_id").notNull().references(() => collectionItems.id),
  tagId: text("tag_id").notNull().references(() => tags.id),
  source: text("source", { enum: ['derived', 'manual'] }).notNull(),
  ruleVersion: text("rule_version"),
}, (t) => [
  check("item_tags_check_1", sql`source IN ('derived','manual')`),
  primaryKey({ columns: [t.itemId, t.tagId, t.source] }),
  index("item_tags_tag_id_idx").on(t.tagId)
]);

export const importRecords = sqliteTable("import_records", {
  id: text("id").primaryKey().notNull(),
  batchId: text("batch_id").notNull().references(() => importBatches.id),
  sourceRecordNumber: integer("source_record_number").notNull(),
  itemId: text("item_id").references(() => collectionItems.id),
  sourceRowJson: text("source_row_json").notNull(),
  normalizationAuditJson: text("normalization_audit_json").notNull(),
  status: text("status", { enum: ['imported', 'skipped'] }).notNull(),
  issueCodesJson: text("issue_codes_json").notNull(),
}, (t) => [
  check("import_records_check_1", sql`source_record_number > 0`),
  check("import_records_check_2", sql`status IN ('imported','skipped')`),
  check("import_records_check_3", sql`json_valid(source_row_json)`),
  check("import_records_check_4", sql`json_valid(normalization_audit_json)`),
  check("import_records_check_5", sql`json_valid(issue_codes_json)`),
  uniqueIndex("import_records_batch_id_source_record_number_uq").on(t.batchId, t.sourceRecordNumber),
  index("import_records_item_id_idx").on(t.itemId)
]);

export const collectionState = sqliteTable("collection_state", {
  id: integer("id").primaryKey().notNull(),
  revision: integer("revision").notNull().default(sql`0`),
}, () => [
  check("collection_state_check_1", sql`id = 1`),
  check("collection_state_check_2", sql`revision >= 0`)
]);

export const externalRefs = sqliteTable("external_refs", {
  id: text("id").primaryKey().notNull(),
  provider: text("provider").notNull(),
  providerEntityType: text("provider_entity_type").notNull(),
  externalId: text("external_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  matchBasis: text("match_basis").notNull(),
  isOwnerConfirmed: integer("is_owner_confirmed").notNull().default(sql`0`),
  seriesId: text("series_id").references(() => series.id),
  volumeEditionId: text("volume_edition_id").references(() => volumeEditions.id),
  albumId: text("album_id").references(() => albums.id),
  releaseId: text("release_id").references(() => albumReleases.id),
  creatorId: text("creator_id").references(() => creators.id),
}, (t) => [
  check("external_refs_check_1", sql`is_owner_confirmed IN (0,1)`),
  check("external_refs_check_2", sql`(series_id IS NOT NULL) + (volume_edition_id IS NOT NULL) + (album_id IS NOT NULL) + (release_id IS NOT NULL) + (creator_id IS NOT NULL) = 1`),
  uniqueIndex("external_refs_provider_provider_entity_type_external_id_uq").on(t.provider, t.providerEntityType, t.externalId),
  index("external_refs_series_id_idx").on(t.seriesId),
  index("external_refs_volume_edition_id_idx").on(t.volumeEditionId),
  index("external_refs_album_id_idx").on(t.albumId),
  index("external_refs_release_id_idx").on(t.releaseId),
  index("external_refs_creator_id_idx").on(t.creatorId)
]);

export const metadataCache = sqliteTable("metadata_cache", {
  cacheKey: text("cache_key").primaryKey().notNull(),
  provider: text("provider").notNull(),
  adapterVersion: text("adapter_version").notNull(),
  payloadJson: text("payload_json"),
  status: text("status", { enum: ['ready', 'missing', 'failed'] }).notNull(),
  fetchedAt: text("fetched_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  retryAfter: text("retry_after"),
}, (t) => [
  check("metadata_cache_check_1", sql`status IN ('ready','missing','failed')`),
  check("metadata_cache_check_2", sql`payload_json IS NULL OR (json_valid(payload_json) AND length(payload_json) <= 1048576)`),
  index("metadata_cache_expires_at_idx").on(t.expiresAt)
]);

export const providerState = sqliteTable("provider_state", {
  provider: text("provider").primaryKey().notNull(),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  nextAllowedAt: text("next_allowed_at").notNull(),
  blockedUntil: text("blocked_until"),
});

