# Stage 3 — Metadata, search, and persistent collection management

Stage 3 implements the user's revised scope on the existing Astro 5 / React / Cloudflare Pages architecture. The 27-table schema, reviewed migration, original CSV and deterministic seed importer are unchanged. The existing shelf, typography, colors, themes and responsive drawers are retained. No hosted deployment is claimed.

## Use the application

Follow the local D1 setup in the [README](../README.md), then run `npm run dev`. **Add to collection** (mobile **Add**) opens the form to create a manga volume or CD. A series detail offers **Add another copy**, and each physical copy has an **Edit copy** action. Saving and confirmed deletion update D1 and refresh the shelf. Separate copies retain separate UUIDs, notes and acquisition dates. No rebuild is required.

Manga entry supports existing/new series, authors, alternate titles, edition, volume, publisher, EN/JP/KR language, numbering basis, acquisition date, notes, tags and artwork. Series titles/authors/aliases are shared catalog fields; editing them updates that series and invalidates stale edits to its other copies. Adding a copy preserves existing series titles/authors. Artwork belongs to the volume edition. CD entry supports artists, release date precision, edition, multiple label/catalog pairs, media formats, disc titles and editable multi-disc tracklists. A CD correction selects a revised release without overwriting another physical copy's release metadata.

Metadata suggestions are optional. Enable automatic suggestions or use **Find metadata**; review candidates, select a series/release and apply the resulting fields. **Retry lookup** bypasses cached failures, while retaining provider rate limits. Native and alternate titles can be searched. Entry and saving continue to work without providers. Artwork can also be entered as a public HTTPS URL, with an explicit edition/representative designation. Saved artwork has a cache retry action.

Search matches series/edition names, alternate titles, creators, publisher/label, notes and catalog numbers. It supports one edit/transposition in words of four or more letters; numbers and short tokens use exact substrings. Media, publisher/label, language, acquisition year, memory tag and edition/format filters combine on the same copy. Filters remain in the URL and have a reset action and empty-result state. CD language is not inferred because the preserved schema has no CD language field.

Memory classification retains the original deterministic rules for gifts from Sammy, Kinokuniya, box sets, proxy hauls and Korea trips, and adds generic Gifts. Derived tags follow notes; manual tags are stored separately. The editor previews automatic tags and allows manual replacement, including clearing tags. For an untagged record with no matching note, automatic suggestions default on when reopened.

## Provider behavior

| Provider | Implemented behavior |
| --- | --- |
| MangaDex | Canonical/alternate-title search, creator/alias suggestions, volume-number and cover-locale matching. A matching number and EN/JP/KR locale is offered with a physical-edition/publisher confirmation warning. Other covers are explicitly representative. All MangaDex image delivery uses the private proxy or R2. |
| Open Library | Language-aware work search when MangaDex is unavailable or has no candidates, or by explicit choice. Work covers are representative, never claimed as verified numbered-volume covers. Direct image delivery respects its cover guidance. |
| MusicBrainz | Artist/album search; selectable country/date/edition/format candidates; release detail supplies labels, catalog numbers, disc positions/formats, track titles/durations and partial/full release dates. |
| Cover Art Archive | Exact release cover first; release-group art is an explicit representative fallback. Eligible selected images are cached in R2. Missing artwork leaves metadata and owned copies intact. |
| iTunes Search | Digital-album metadata fallback with a warning that the physical release needs confirmation. Apple promotional artwork is deliberately not copied into a private collection; CAA, manual artwork and the designed cover fallback remain available. |

AniList is unnecessary for the implemented MangaDex/Open Library fallback. No Discogs API credentials or account synchronization are used. Sample CDs remain labeled and unresolved until the owner chooses an edition; provider guesses are never silently applied to them.

Provider JSON is cached in D1 for seven days, 404 misses for an hour and transient failures for a minute. Force retry does not bypass a provider lease or Retry-After. D1 coordinates at least 1.1 seconds between requests per provider and 3.1 seconds for iTunes. Requests identify Strawby Stacks and use `METADATA_CONTACT` or the project URL. Requests have an eight-second timeout, response limits and redirect allowlists. Rate-limit responses apply a bounded Retry-After delay. Ambiguous results are shown for review.

Selected MangaDex/CAA JPEG, PNG and WebP files are size-checked, signature-checked, hashed and stored in private R2. The immutable object is uploaded before its D1 reference changes. Repeated cache requests reuse the object. Failed caching retains the saved source URL and retry information; it never deletes or rolls back the physical copy. Manual/Open Library artwork stays external. JSON backups include artwork references; image bytes need a separate R2 backup.

Policies reviewed: [MangaDex limitations](https://api.mangadex.org/docs/2-limitations/), [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API), [MusicBrainz rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting), [CAA API](https://musicbrainz.org/doc/Cover_Art_Archive/API), [Open Library search](https://openlibrary.org/dev/docs/api/search), [Open Library covers](https://openlibrary.org/dev/docs/api/covers), [Apple Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html).

## Import, export and restoration

Open **Import / export**. Downloads include full collection JSON and separate manga/CD CSV files. JSON version 1 exports all 24 collection/catalog/provenance tables, including sample records and physical-copy identities. It omits operational metadata caches, provider leases and collection revision. CSV excludes samples by default and offers an explicit sample option.

Choose a file and preview before committing. Every CSV row has a title, volume/language where applicable, date, validation results and duplicate status. Files are limited to 900 KB and 1,000 rows, with a 1 MB normalized preview limit. Split larger imports. Exact Copy IDs always skip; other candidate duplicates skip by default and can explicitly be included as separate physical copies. A changed collection invalidates a stale preview. Repeating identical file bytes and mapping options is a no-op after completion, including after later owner edits.

CSV imports stage small atomic D1 batches, hide all staged copies until completion, and store original rows plus normalized values in the import audit. Resume after interruption, or confirm cancellation to remove only that unfinished import's copies. Normal edits/exports wait for the active import to finish or be cancelled. The panel discovers unfinished imports from D1 even after local browser storage is lost. Cancellation can leave unused catalog rows, which are harmless and retained in full backups.

Templates: [manga CSV](../public/templates/manga.csv), [CD CSV](../public/templates/cds.csv). The example rows are examples, not personal collection data.

| Input | Mapping |
| --- | --- |
| Original manga CSV | `Title,Volume,Author,Publisher,Date Acquired,Notes`; original legend columns are ignored. Original corrections, language rules and note cascade markers are reused. Uncertain omnibus numbering remains `source_record`. Optional export columns preserve Copy ID, canonical/edition titles, language, format, aliases, tags and artwork. |
| CD CSV | `Title` required. Optional `Artist`, `Edition`, `Release Date`, `Label`, `Catalog Number`, `Format`, `Date Acquired`, `Notes`, `Tags`, `Copy ID`, `Artwork URL`, `Artwork Scope`. `Labels JSON`, `Media JSON` and `Tracks JSON` preserve multiple labels/discs/tracks from exported files. Multiple names/tags use ` | `. |
| Discogs CSV | `Artist`, `Title`, `Label`, `Catalogno`, `Format`, `Released`, `Collection Notes` are mapped when available. Unmapped fields, including release IDs/folder/condition/custom fields, remain in notes and source provenance. `Date Added` is retained as source data unless the explicit acquisition-date mapping is selected. Non-CD/unknown formats are marked for review. |

Dates accept calendar `YYYY-MM-DD` or original `M/D/YYYY`; release dates support year, month or full date. CSV quoting handles commas, quotes, Unicode and embedded newlines. Formula-like cells receive a spreadsheet-safe apostrophe; JSON is the exact backup for these values. CSV remains a portable ownership view, not the complete relational restore format.

To restore, select **JSON backup**, preview, confirm and import. The server validates the version, table/column allowlists, identities, physical subtypes and artwork references. All relational inserts occur in one atomic D1 batch with foreign-key/CHECK enforcement. Identical existing rows are skipped. Conflicting existing identities are rejected rather than overwritten; restore an older snapshot into a fresh migrated database. Restore R2 objects separately for offline reuse of cached images. Missing cached objects can fall back to retained source artwork.

## Authentication and deployment configuration

The chosen personal-app authentication is **Cloudflare Access with one allowed owner email**, plus server-side signed JWT verification using pinned `jose`. All dynamic collection reads, exports, metadata requests, artwork routes and mutations pass the middleware. No browser API secrets or unrestricted writes are present.

Local use requires both `APP_ENV=local` and `LOCAL_DEV_AUTH=true`, and a localhost request URL. Hosted requests fail closed until configured. Provision separate preview/production D1 and R2 resources, apply the reviewed migration, and configure:

```text
APP_ENV=preview                    # production in production
APP_ORIGIN=https://exact-private-host.example.com
ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
ACCESS_AUDIENCE=the-access-application-audience
ACCESS_OWNER_EMAIL=your-owner-email
METADATA_CONTACT=your-contact-URL-or-email
```

Protect the hostname with an Access application whose allow policy includes only the owner. Configure the exact origin and audience for that environment. Do not set local bypass flags on hosted environments. The worker independently verifies RS256 signature, issuer, audience, expiry, required identity claims and owner email. The exact configured origin is required, so unconfigured Pages/preview/direct hostnames remain closed. See [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

Writes require an exact same-origin `Origin`, a custom request header, and a permitted fetch context. There is no cross-origin credentialed write endpoint. Reads/responses are private and no-store. Client and server use the same input schema, with bounded bodies, calendar/track/URL validation, useful 422 errors and 409 concurrency conflicts. Deletes require explicit confirmation. Creation uses request UUIDs plus payload hashes; changed retries cannot silently discard edits.

Cloudflare resources/owner settings are not provisioned in this repository. Hosted quota and direct-origin tests remain deployment gates. Interactive imports are intentionally bounded but can exceed the Workers Free 50-query-per-invocation D1 allowance for larger records/chunks; use an appropriate paid limit for hosted collection management and verify that environment. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/). Existing dependency audit findings must also be resolved before claiming production readiness.

## Verification record

Local checks cover real D1 CRUD, independent physical copies, stale edits, idempotent/changed retries, shared-series edits, manual/derived tags, invalid inputs, staged imports/resume/cancel, duplicate detection, original-format CSV, Discogs mapping, CSV export and exact JSON restoration. Provider tests inject timeouts, malformed data, unavailable covers and rate limits; external services are not required for the test suite.

Live provider checks additionally selected Japanese volume 1 of *A Sign of Affection* from MangaDex and the 2022-12-28 Japanese limited *結束バンド* release from MusicBrainz/CAA (Aniplex, SVWC-70613 / SVWC-70614, CD plus Blu-ray, 18 tracks). Both saved to disposable real local D1, both artwork files cached in real local R2, and both survived closing/reopening the runtime. An alternate MusicBrainz edition also exercised an explicitly representative release-group cover. Live checks do not establish that every collection volume can be matched.

Final automated command results are in [TESTING.md](TESTING.md) and [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md). Browser tests use disposable seeded D1/R2, add/edit/delete both media types with reloads between operations, and exercise combined filters, provider failure/manual entry, preview/import/export and restore. The default test runner never mutates the development collection. `STRAWBY_TEST_URL` must point to a disposable seeded runtime if supplied explicitly.

Remaining work is hosted provisioning/verification, dependency remediation, broader browser/device/performance coverage, haul timeline and remaining analytics. Stage 3 does not deploy the application or replace the established platform.
