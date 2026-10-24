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
| Open Library | Edition-level volume search: an edition whose own title is the series title plus the volume number (for example "Spy x Family, Vol. 4"), in the owned language, with a cover. Publisher or manga-imprint matches rank first. Different publishers are flagged (often the light novel), and self-publishing platforms are rejected. It runs alongside MangaDex because MangaDex rarely has English volume covers. Work-level search remains a representative fallback that is never claimed as a numbered-volume cover. |
| MusicBrainz | Artist/album search; selectable country/date/edition/format candidates; release detail supplies labels, catalog numbers, disc positions/formats, track titles/durations and partial/full release dates. |
| Cover Art Archive | Exact release cover first; release-group art is an explicit representative fallback. Eligible selected images are cached in R2. Missing artwork leaves metadata and owned copies intact. |
| iTunes Search | Digital-album metadata fallback with a warning that the physical release needs confirmation. Apple promotional artwork is deliberately not copied into a private collection; CAA, manual artwork and the designed cover fallback remain available. |

AniList is unnecessary for the implemented MangaDex/Open Library fallback. No Discogs API credentials or account synchronization are used. Sample CDs remain labeled and unresolved until the owner chooses an edition; provider guesses are never silently applied to them.

Provider JSON is cached in D1 for seven days, 404 misses for an hour and transient failures for a minute. Force retry does not bypass a provider lease or Retry-After. D1 coordinates at least 1.1 seconds between requests per provider and 3.1 seconds for iTunes. Requests identify Strawby Stacks and use `METADATA_CONTACT` or the project URL. Requests have an eight-second timeout, response limits and redirect allowlists. Rate-limit responses apply a bounded Retry-After delay. Ambiguous results are shown for review.

Selected MangaDex/CAA/Open Library JPEG, PNG and WebP files are size-checked, signature-checked, hashed and stored in private R2. The immutable object is uploaded before its D1 reference changes. Repeated cache requests reuse the object. Failed caching retains the saved source URL and retry information; it never deletes or rolls back the physical copy. Open Library covers are cached because their archive.org storage is intermittently unavailable (503). This is bounded to the owner's selected covers, rate-limited and private, and uses fewer requests than reloading the images on every view. Manual artwork stays external. JSON backups include artwork references; image bytes need a separate R2 backup.

Policies reviewed: [MangaDex limitations](https://api.mangadex.org/docs/2-limitations/), [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API), [MusicBrainz rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting), [CAA API](https://musicbrainz.org/doc/Cover_Art_Archive/API), [Open Library search](https://openlibrary.org/dev/docs/api/search), [Open Library covers](https://openlibrary.org/dev/docs/api/covers), [Apple Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html).

## Light novels and books

**Light novels** stay in the Manga tab under their series. Cards, detail rows and spines show an LN mark, and **Filters → Manga type** shows manga only or light novels only (URL `type=`). The header and stats count light novels within manga volumes and also report them separately. The medium belongs to an edition. Changing **Media type** on one copy in the editor reclassifies every copy of that edition in place, increments their versions, and clears unattended (not owner-selected) artwork matched for the old medium. Owner-selected artwork is kept.

**Books** that are not manga or light novels have their own **Books** tab and an **Add → Book (not manga)** form: title, authors, optional series and number, language, publisher, format, date, notes and tags. A standalone book shows **Copies** without volume numbers or gap checks. A book with a series and different numbers shows **Books in this series**. In the shelf view, all books share one **Books · by author** shelf (first author, then title and number). Books are excluded from the manga record on `/foundation`.

**Find metadata** and the cover utility send books to an Open Library edition search: the edition title must start with the owned title, the language must match, authors must be compatible, and study guides, summaries and self-published notebooks are rejected. The owned publisher is searched first. Light novels skip MangaDex (comics only) and use Open Library editions with light-novel numbering words ("(light novel)", Vertical's "Part N", or an unnumbered standalone novel as volume 1) and light-novel imprints (Yen On, Airship, Haikasoru, Vertical, …). Unattended light-novel matches also need positive evidence of the novel edition, because the same publisher often prints the manga under an identical "Vol. N" title. Manga titles marked "(light novel)" or "Part N" never match manga.

The volume CSV (Import & export → **Manga & books CSV**) has a **Medium** column (`Manga`, `Light novel` or `Book`; blank is manga). JSON backups include `medium`. Version 1 backups made before it restore with `manga`.

## Cover display

Loaded artwork fills the same cover footprint on its own, with no book or jewel-case frame around it. The typographic cover appears only while the image loads or if it fails. Representative art keeps a small label.

## CD shelf view

In the virtual shelf view, all visible CD copies share one **CDs · by artist** shelf instead of one shelf per album. They are ordered alphabetically by first credited artist (case-insensitive), then album title. CDs without a known artist come last. Each CD spine shows its artist (with a SAMPLE marker for demonstration CDs) and keeps the title to one line. Manga keeps one shelf per series.

## Automated cover caching utility

`npm run covers:cache` fills missing artwork for owned copies without the editor. It uses the same provider adapters, D1 metadata cache, provider leases and R2 cache path as interactive lookup:

1. **Manga matching.** Only standard-format volume editions with printed numbering and no artwork are considered. Collector's, art book, anthology and uncertain omnibus numbering are skipped. A series is matched only when exactly one MangaDex title has a normalized name equal to the series title or an alias, with compatible credits (romanization-tolerant token comparison). Artwork is applied when exactly one MangaDex cover has the owned volume number and language. Otherwise, the Open Library edition search above is tried with the owned publisher. An edition is applied unattended only when its publisher or a known manga imprint matches (VIZ ↔ Shonen Jump/Shojo Beat, Kodansha ↔ Vertical, and so on), or when either side lists no publisher. Light-novel imprints such as Yen On deliberately do not match Yen Press. Ambiguous titles, multiple same-volume MangaDex covers, other-publisher editions and missing covers are reported for review in the editor. Representative or other-language covers are never applied automatically. Search results are cached, so a rerun does not repeat them.
2. **R2 caching.** Every referenced MangaDex/CAA/Open Library image not yet in R2 is cached, including owner selections whose earlier cache attempt failed. Image failures retain the source reference.
3. **CDs.** A CD edition is never guessed. CDs without a selected release are reported as needing selection in the editor.

Applied artwork has `is_owner_selected = 0` and an attribution stating that the volume/language match is automatic and that the publisher edition needs confirmation. The detail drawer shows this attribution. Owner-selected artwork is never replaced. If an owner selects artwork while the utility is running, that choice is kept. Applying artwork increments the versions of the affected copies, so a stale editor form returns a 409 instead of clearing the new cover. Re-saving a copy keeps the same cached asset.

Progress is checkpointed in D1. Series matches are written to `external_refs` (`match_basis = automatic-exact-title`, unconfirmed), applied covers to `cover_assets`, and provider responses to `metadata_cache`. A rerun repeats no completed or cached work. A provider `Retry-After` or busy lease defers the remaining series; rerun later. `--limit N` counts only series that needed provider requests, so repeated limited runs move through the collection. `--dry-run` reports matches without changing the collection or R2; provider responses are still cached. The report lists titles, volumes, languages and reasons only; it contains no notes.

The utility opens the local Wrangler D1/R2 state (`--persist`, default `.wrangler/state/v3`). Like seeding, it has no remote/hosted mode. Hosted enrichment would require separately verified credentials.

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

**With Open Library added**, a live run on a copy of the development state (which already held the owner's 35 MangaDex covers) applied 57 more Open Library edition covers and cached 56 in R2. One cover (*Blue Box* 2) was left as an external reference while archive.org returned 503; a rerun retries it. That makes 92 of 176 volume editions (93 of 177 copies), and 26 of 38 series show real artwork on the shelf. A visual check confirmed the correct English editions for *A Silent Voice*, *Bakemonogatari*, *Laid-Back Camp*, *Evangelion*, *Spy x Family*, *Summertime Rendering* and *Sweetness & Lightning*. An earlier substring publisher comparison let through two *86* light-novel covers and the *My Happy Marriage* light novel. Exact publisher/imprint matching now rejects them. Remaining gaps are volumes Open Library lists without a cover (for example *Laid-Back Camp* 7–14), or lists only as unnumbered or knock-off records (*Wotakoi*, *The Quintessential Quintuplets*).

Earlier MangaDex-only run: the cover utility was run live against a disposable copy of the seeded local D1/R2 state. It made no change to the development collection. Matches were found for 35 of the 176 seeded volume editions, covering 36 of the 177 copies (for example *Chainsaw Man* 1–11 EN, *K-ON!* 1–4 JP, *86* 1–3 EN, *Goodbye, Eri* and *The Yakuza's Guide to Babysitting* 1–2), and all 35 images were cached in R2. 129 editions were unmatched with stated reasons, mostly because MangaDex has no English cover for that volume. The remaining 12 collector's, art book, anthology and uncertain omnibus editions were skipped by design. There were 0 failures, and all four sample CDs were reported as needing selection. A limited run followed by reruns resumed without repeating requests. A visual spot check of seven cached covers confirmed the correct series and volume. Two titles (*The Quintessential Quintuplets*, *The Fragrant Flower Blooms With Dignity*) were correctly withheld as ambiguous.

Live provider checks additionally selected Japanese volume 1 of *A Sign of Affection* from MangaDex and the 2022-12-28 Japanese limited *結束バンド* release from MusicBrainz/CAA (Aniplex, SVWC-70613 / SVWC-70614, CD plus Blu-ray, 18 tracks). Both saved to disposable real local D1, both artwork files cached in real local R2, and both survived closing/reopening the runtime. An alternate MusicBrainz edition also exercised an explicitly representative release-group cover. Live checks do not establish that every collection volume can be matched.

Final automated command results are in [TESTING.md](TESTING.md) and [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md). Browser tests use disposable seeded D1/R2, add/edit/delete both media types with reloads between operations, and exercise combined filters, provider failure/manual entry, preview/import/export and restore. The default test runner never mutates the development collection. `STRAWBY_TEST_URL` must point to a disposable seeded runtime if supplied explicitly.

Remaining work is hosted provisioning/verification (including any hosted cover-utility credentials), dependency remediation, broader browser/device/performance coverage, haul timeline and remaining analytics. Stage 3 does not deploy the application or replace the established platform.
