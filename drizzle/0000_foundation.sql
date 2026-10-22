-- Stage 1 baseline. Keep aligned with src/server/db/schema/index.ts.
-- Apply through Wrangler; the SQLite adapter is an offline verification harness.
--> statement-breakpoint
CREATE TABLE "cover_assets" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "provider" TEXT NOT NULL,
  "source_url" TEXT,
  "source_record_id" TEXT,
  "storage_mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "match_scope" TEXT NOT NULL,
  "source_language" TEXT,
  "fetched_at" TEXT,
  "retry_after" TEXT,
  "last_error_code" TEXT,
  "policy_version" TEXT NOT NULL,
  "attribution" TEXT,
  "is_owner_selected" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "cover_assets_check_1" CHECK (storage_mode IN ('r2','external')),
  CONSTRAINT "cover_assets_check_2" CHECK (status IN ('pending','ready','missing','failed')),
  CONSTRAINT "cover_assets_check_3" CHECK (match_scope IN ('edition','representative')),
  CONSTRAINT "cover_assets_check_4" CHECK (source_language IS NULL OR source_language IN ('EN','JP','KR')),
  CONSTRAINT "cover_assets_check_5" CHECK (is_owner_selected IN (0,1))
);
--> statement-breakpoint
CREATE TABLE "cover_variants" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "cover_asset_id" TEXT NOT NULL REFERENCES "cover_assets"("id"),
  "variant" TEXT NOT NULL,
  "object_key" TEXT,
  "external_url" TEXT,
  "sha256" TEXT,
  "mime_type" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "byte_size" INTEGER,
  "etag" TEXT,
  CONSTRAINT "cover_variants_check_1" CHECK (variant IN ('grid','detail','original')),
  CONSTRAINT "cover_variants_check_2" CHECK ((object_key IS NOT NULL) + (external_url IS NOT NULL) = 1),
  CONSTRAINT "cover_variants_check_3" CHECK (width IS NULL OR width > 0),
  CONSTRAINT "cover_variants_check_4" CHECK (height IS NULL OR height > 0),
  CONSTRAINT "cover_variants_check_5" CHECK (byte_size IS NULL OR byte_size > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cover_variants_cover_asset_id_variant_uq" ON "cover_variants" ("cover_asset_id", "variant");
--> statement-breakpoint
CREATE TABLE "creators" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "display_name" TEXT NOT NULL,
  "search_key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  CONSTRAINT "creators_check_1" CHECK (kind IN ('person','group','collective','unknown'))
);
--> statement-breakpoint
CREATE INDEX "creators_search_key_idx" ON "creators" ("search_key");
--> statement-breakpoint
CREATE TABLE "publishers" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "publishers_normalized_name_uq" ON "publishers" ("normalized_name");
--> statement-breakpoint
CREATE TABLE "labels" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "labels_normalized_name_uq" ON "labels" ("normalized_name");
--> statement-breakpoint
CREATE TABLE "series" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "canonical_title" TEXT NOT NULL,
  "sort_title" TEXT NOT NULL,
  "description" TEXT,
  "representative_cover_id" TEXT REFERENCES "cover_assets"("id")
);
--> statement-breakpoint
CREATE INDEX "series_sort_title_idx" ON "series" ("sort_title");
--> statement-breakpoint
CREATE INDEX "series_representative_cover_id_idx" ON "series" ("representative_cover_id");
--> statement-breakpoint
CREATE TABLE "series_aliases" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "series_id" TEXT NOT NULL REFERENCES "series"("id"),
  "title" TEXT NOT NULL,
  "search_key" TEXT NOT NULL,
  "locale" TEXT,
  "kind" TEXT NOT NULL,
  CONSTRAINT "series_aliases_check_1" CHECK (kind IN ('native','romanized','edition','legacy'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "series_aliases_series_id_search_key_kind_uq" ON "series_aliases" ("series_id", "search_key", "kind");
--> statement-breakpoint
CREATE INDEX "series_aliases_search_key_idx" ON "series_aliases" ("search_key");
--> statement-breakpoint
CREATE TABLE "series_creators" (
  "series_id" TEXT NOT NULL REFERENCES "series"("id"),
  "creator_id" TEXT NOT NULL REFERENCES "creators"("id"),
  "role" TEXT NOT NULL,
  "credit_order" INTEGER NOT NULL,
  CONSTRAINT "series_creators_check_1" CHECK (credit_order >= 0),
  PRIMARY KEY ("series_id", "creator_id", "role")
);
--> statement-breakpoint
CREATE INDEX "series_creators_creator_id_idx" ON "series_creators" ("creator_id");
--> statement-breakpoint
CREATE TABLE "edition_runs" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "series_id" TEXT NOT NULL REFERENCES "series"("id"),
  "edition_title" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "language_basis" TEXT NOT NULL,
  "publisher_id" TEXT REFERENCES "publishers"("id"),
  "format" TEXT NOT NULL,
  "numbering_basis" TEXT NOT NULL,
  "numbering_verified" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "edition_runs_check_1" CHECK (language IN ('EN','JP','KR')),
  CONSTRAINT "edition_runs_check_2" CHECK (language_basis IN ('specified','assumed','confirmed')),
  CONSTRAINT "edition_runs_check_3" CHECK (format IN ('standard','omnibus','collectors','artbook','anthology','unknown')),
  CONSTRAINT "edition_runs_check_4" CHECK (numbering_basis IN ('printed','source_record','unknown')),
  CONSTRAINT "edition_runs_check_5" CHECK (numbering_verified IN (0,1))
);
--> statement-breakpoint
CREATE INDEX "edition_runs_series_id_language_publisher_id_idx" ON "edition_runs" ("series_id", "language", "publisher_id");
--> statement-breakpoint
CREATE INDEX "edition_runs_publisher_id_idx" ON "edition_runs" ("publisher_id");
--> statement-breakpoint
CREATE TABLE "volume_editions" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "edition_run_id" TEXT NOT NULL REFERENCES "edition_runs"("id"),
  "volume_label" TEXT NOT NULL,
  "volume_sort" INTEGER,
  "numbering_key" TEXT NOT NULL,
  "isbn13" TEXT,
  "cover_asset_id" TEXT REFERENCES "cover_assets"("id"),
  "metadata_state" TEXT NOT NULL DEFAULT 'unverified',
  CONSTRAINT "volume_editions_check_1" CHECK (metadata_state IN ('unverified','partial','confirmed')),
  CONSTRAINT "volume_editions_check_2" CHECK (isbn13 IS NULL OR (length(isbn13) = 13 AND isbn13 NOT GLOB '*[^0-9]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "volume_editions_edition_run_id_numbering_key_uq" ON "volume_editions" ("edition_run_id", "numbering_key");
--> statement-breakpoint
CREATE INDEX "volume_editions_edition_run_id_volume_sort_idx" ON "volume_editions" ("edition_run_id", "volume_sort");
--> statement-breakpoint
CREATE INDEX "volume_editions_cover_asset_id_idx" ON "volume_editions" ("cover_asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX volume_editions_confirmed_isbn_uq ON volume_editions(isbn13) WHERE isbn13 IS NOT NULL AND metadata_state = 'confirmed';
--> statement-breakpoint
CREATE TABLE "albums" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "title" TEXT NOT NULL,
  "sort_title" TEXT NOT NULL,
  "description" TEXT
);
--> statement-breakpoint
CREATE INDEX "albums_sort_title_idx" ON "albums" ("sort_title");
--> statement-breakpoint
CREATE TABLE "album_creators" (
  "album_id" TEXT NOT NULL REFERENCES "albums"("id"),
  "creator_id" TEXT NOT NULL REFERENCES "creators"("id"),
  "role" TEXT NOT NULL,
  "credit_order" INTEGER NOT NULL,
  "credited_as" TEXT,
  "join_phrase" TEXT,
  CONSTRAINT "album_creators_check_1" CHECK (credit_order >= 0),
  PRIMARY KEY ("album_id", "creator_id", "role")
);
--> statement-breakpoint
CREATE INDEX "album_creators_creator_id_idx" ON "album_creators" ("creator_id");
--> statement-breakpoint
CREATE TABLE "album_releases" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "album_id" TEXT NOT NULL REFERENCES "albums"("id"),
  "edition_title" TEXT,
  "release_date" TEXT,
  "date_precision" TEXT,
  "country_code" TEXT,
  "edition_description" TEXT,
  "barcode" TEXT,
  "cover_asset_id" TEXT REFERENCES "cover_assets"("id"),
  "metadata_state" TEXT NOT NULL DEFAULT 'unverified',
  CONSTRAINT "album_releases_check_1" CHECK (metadata_state IN ('unverified','partial','confirmed')),
  CONSTRAINT "album_releases_check_2" CHECK ((release_date IS NULL AND date_precision IS NULL) OR (release_date IS NOT NULL AND date_precision IS NOT NULL AND ((date_precision = 'year' AND release_date GLOB '[0-9][0-9][0-9][0-9]') OR (date_precision = 'month' AND release_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]') OR (date_precision = 'day' AND release_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))))
);
--> statement-breakpoint
CREATE INDEX "album_releases_barcode_idx" ON "album_releases" ("barcode");
--> statement-breakpoint
CREATE INDEX "album_releases_album_id_idx" ON "album_releases" ("album_id");
--> statement-breakpoint
CREATE INDEX "album_releases_cover_asset_id_idx" ON "album_releases" ("cover_asset_id");
--> statement-breakpoint
CREATE TABLE "release_labels" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "release_id" TEXT NOT NULL REFERENCES "album_releases"("id"),
  "label_id" TEXT NOT NULL REFERENCES "labels"("id"),
  "catalog_number" TEXT,
  "credit_order" INTEGER NOT NULL,
  CONSTRAINT "release_labels_check_1" CHECK (credit_order >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "release_labels_release_id_label_id_catalog_number_uq" ON "release_labels" ("release_id", "label_id", "catalog_number");
--> statement-breakpoint
CREATE INDEX "release_labels_label_id_catalog_number_idx" ON "release_labels" ("label_id", "catalog_number");
--> statement-breakpoint
CREATE TABLE "release_media" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "release_id" TEXT NOT NULL REFERENCES "album_releases"("id"),
  "position" INTEGER NOT NULL,
  "format" TEXT NOT NULL,
  "title" TEXT,
  CONSTRAINT "release_media_check_1" CHECK (position > 0),
  CONSTRAINT "release_media_check_2" CHECK (format IN ('CD','Blu-ray','DVD','other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "release_media_release_id_position_uq" ON "release_media" ("release_id", "position");
--> statement-breakpoint
CREATE TABLE "tracks" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "medium_id" TEXT NOT NULL REFERENCES "release_media"("id"),
  "position" INTEGER NOT NULL,
  "printed_number" TEXT,
  "title" TEXT NOT NULL,
  "duration_ms" INTEGER,
  "recording_mbid" TEXT,
  CONSTRAINT "tracks_check_1" CHECK (position > 0),
  CONSTRAINT "tracks_check_2" CHECK (duration_ms IS NULL OR duration_ms >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_medium_id_position_uq" ON "tracks" ("medium_id", "position");
--> statement-breakpoint
CREATE TABLE "import_batches" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "source_kind" TEXT NOT NULL,
  "source_filename" TEXT NOT NULL,
  "source_sha256" TEXT NOT NULL,
  "mapping_version" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "preview_revision" INTEGER,
  "error_summary" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_batches_check_1" CHECK (status IN ('preview','committing','complete','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_source_kind_source_sha256_mapping_version_uq" ON "import_batches" ("source_kind", "source_sha256", "mapping_version");
--> statement-breakpoint
CREATE TABLE "collection_items" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "media_kind" TEXT NOT NULL,
  "acquired_on" TEXT,
  "notes" TEXT,
  "is_sample" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "import_batch_id" TEXT REFERENCES "import_batches"("id"),
  "idempotency_key" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collection_items_check_1" CHECK (media_kind IN ('manga','cd')),
  CONSTRAINT "collection_items_check_2" CHECK (is_sample IN (0,1)),
  CONSTRAINT "collection_items_check_3" CHECK (version >= 1),
  CONSTRAINT "collection_items_check_4" CHECK (acquired_on IS NULL OR (acquired_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(acquired_on, '+0 days') IS NOT NULL AND date(acquired_on, '+0 days') = acquired_on))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_id_media_kind_uq" ON "collection_items" ("id", "media_kind");
--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_idempotency_key_uq" ON "collection_items" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "collection_items_is_sample_media_kind_acquired_on_idx" ON "collection_items" ("is_sample", "media_kind", "acquired_on");
--> statement-breakpoint
CREATE INDEX "collection_items_import_batch_id_idx" ON "collection_items" ("import_batch_id");
--> statement-breakpoint
CREATE TABLE "volumes" (
  "item_id" TEXT PRIMARY KEY NOT NULL,
  "media_kind" TEXT NOT NULL DEFAULT 'manga',
  "volume_edition_id" TEXT NOT NULL REFERENCES "volume_editions"("id"),
  CONSTRAINT "volumes_check_1" CHECK (media_kind = 'manga'),
  FOREIGN KEY ("item_id", "media_kind") REFERENCES "collection_items"("id", "media_kind")
);
--> statement-breakpoint
CREATE INDEX "volumes_volume_edition_id_idx" ON "volumes" ("volume_edition_id");
--> statement-breakpoint
CREATE TABLE "cds" (
  "item_id" TEXT PRIMARY KEY NOT NULL,
  "media_kind" TEXT NOT NULL DEFAULT 'cd',
  "release_id" TEXT NOT NULL REFERENCES "album_releases"("id"),
  CONSTRAINT "cds_check_1" CHECK (media_kind = 'cd'),
  FOREIGN KEY ("item_id", "media_kind") REFERENCES "collection_items"("id", "media_kind")
);
--> statement-breakpoint
CREATE INDEX "cds_release_id_idx" ON "cds" ("release_id");
--> statement-breakpoint
CREATE TABLE "tags" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "slug" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  CONSTRAINT "tags_check_1" CHECK (category IN ('memory','edition'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_uq" ON "tags" ("slug");
--> statement-breakpoint
CREATE TABLE "item_tags" (
  "item_id" TEXT NOT NULL REFERENCES "collection_items"("id"),
  "tag_id" TEXT NOT NULL REFERENCES "tags"("id"),
  "source" TEXT NOT NULL,
  "rule_version" TEXT,
  CONSTRAINT "item_tags_check_1" CHECK (source IN ('derived','manual')),
  PRIMARY KEY ("item_id", "tag_id", "source")
);
--> statement-breakpoint
CREATE INDEX "item_tags_tag_id_idx" ON "item_tags" ("tag_id");
--> statement-breakpoint
CREATE TABLE "import_records" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "batch_id" TEXT NOT NULL REFERENCES "import_batches"("id"),
  "source_record_number" INTEGER NOT NULL,
  "item_id" TEXT REFERENCES "collection_items"("id"),
  "source_row_json" TEXT NOT NULL,
  "normalization_audit_json" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "issue_codes_json" TEXT NOT NULL,
  CONSTRAINT "import_records_check_1" CHECK (source_record_number > 0),
  CONSTRAINT "import_records_check_2" CHECK (status IN ('imported','skipped')),
  CONSTRAINT "import_records_check_3" CHECK (json_valid(source_row_json)),
  CONSTRAINT "import_records_check_4" CHECK (json_valid(normalization_audit_json)),
  CONSTRAINT "import_records_check_5" CHECK (json_valid(issue_codes_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "import_records_batch_id_source_record_number_uq" ON "import_records" ("batch_id", "source_record_number");
--> statement-breakpoint
CREATE INDEX "import_records_item_id_idx" ON "import_records" ("item_id");
--> statement-breakpoint
CREATE TABLE "collection_state" (
  "id" INTEGER PRIMARY KEY NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "collection_state_check_1" CHECK (id = 1),
  CONSTRAINT "collection_state_check_2" CHECK (revision >= 0)
);
--> statement-breakpoint
CREATE TABLE "external_refs" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_entity_type" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "fetched_at" TEXT NOT NULL,
  "match_basis" TEXT NOT NULL,
  "is_owner_confirmed" INTEGER NOT NULL DEFAULT 0,
  "series_id" TEXT REFERENCES "series"("id"),
  "volume_edition_id" TEXT REFERENCES "volume_editions"("id"),
  "album_id" TEXT REFERENCES "albums"("id"),
  "release_id" TEXT REFERENCES "album_releases"("id"),
  "creator_id" TEXT REFERENCES "creators"("id"),
  CONSTRAINT "external_refs_check_1" CHECK (is_owner_confirmed IN (0,1)),
  CONSTRAINT "external_refs_check_2" CHECK ((series_id IS NOT NULL) + (volume_edition_id IS NOT NULL) + (album_id IS NOT NULL) + (release_id IS NOT NULL) + (creator_id IS NOT NULL) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "external_refs_provider_provider_entity_type_external_id_uq" ON "external_refs" ("provider", "provider_entity_type", "external_id");
--> statement-breakpoint
CREATE INDEX "external_refs_series_id_idx" ON "external_refs" ("series_id");
--> statement-breakpoint
CREATE INDEX "external_refs_volume_edition_id_idx" ON "external_refs" ("volume_edition_id");
--> statement-breakpoint
CREATE INDEX "external_refs_album_id_idx" ON "external_refs" ("album_id");
--> statement-breakpoint
CREATE INDEX "external_refs_release_id_idx" ON "external_refs" ("release_id");
--> statement-breakpoint
CREATE INDEX "external_refs_creator_id_idx" ON "external_refs" ("creator_id");
--> statement-breakpoint
CREATE TABLE "metadata_cache" (
  "cache_key" TEXT PRIMARY KEY NOT NULL,
  "provider" TEXT NOT NULL,
  "adapter_version" TEXT NOT NULL,
  "payload_json" TEXT,
  "status" TEXT NOT NULL,
  "fetched_at" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "retry_after" TEXT,
  CONSTRAINT "metadata_cache_check_1" CHECK (status IN ('ready','missing','failed')),
  CONSTRAINT "metadata_cache_check_2" CHECK (payload_json IS NULL OR (json_valid(payload_json) AND length(payload_json) <= 1048576))
);
--> statement-breakpoint
CREATE INDEX "metadata_cache_expires_at_idx" ON "metadata_cache" ("expires_at");
--> statement-breakpoint
CREATE TABLE "provider_state" (
  "provider" TEXT PRIMARY KEY NOT NULL,
  "lease_token" TEXT,
  "lease_expires_at" TEXT,
  "next_allowed_at" TEXT NOT NULL,
  "blocked_until" TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_batches_initial_source_uq ON import_batches(source_kind) WHERE source_kind = 'initial-collection';
--> statement-breakpoint
INSERT INTO collection_state(id, revision) VALUES (1, 0);
