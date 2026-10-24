# Decisions, assumptions, and risks

Status: Stage 0 design decisions retained; reviewed 2026-10-21. Source of product authority: [project_specification](../project_specification). No application implementation occurred during planning; Stage 1 implementation and verification are recorded below and in [STAGE1_VALIDATION.md](STAGE1_VALIDATION.md).

## Visual recognition Phase A decisions (2026-10-24)

- **Phase split.** The request named Phase A without defining it. Phase A is barcode scanning end to end; cover recognition (B) and multi-volume batches (C) are roadmap items only.
- **Decoder.** `barcode-detector` 3.2.2 / `zxing-wasm` 3.1.3 (MIT), pinned to versions older than two weeks. The newest releases were 5 days old. The WASM is self-hosted rather than fetched from jsDelivr.
- **No image upload in Phase A.** Decoding is on-device, so no photo retention question arises yet.
- **ISBN trust.** Checksum-valid scans are the only ISBN source. Provider ISBNs are used solely to verify that a record describes the scanned book.
- **ISBN conflicts.** A different recorded ISBN for the same volume edition returns 409 instead of overwriting it.
- **Google Books.** Its `isbn:` search returned nothing in testing, so one ISBN-verified title search, seeded by Open Library, recovers Google records.
- **Script bridging.** MangaDex alternate titles bridge Japanese and Korean titles to owned English series.
- **Preselection.** Only exact titles are preselected. Run reuse requires the same language and format.
- **Rate limits.** D1 fixed windows: 30/min and 400/h for lookups.
- **CSV unchanged.** No ISBN column was added, to preserve import/export compatibility.

## Stage 3 execution adjustments (2026-10-23)

- The user's revised Stage 3 absorbs original Stage 4 editing/import/export work. Existing schema, source CSV, importer and visual tokens are preserved.
- Cloudflare Access is implemented now, before hosted writes can be enabled: signed RS256 JWT, exact issuer/audience/origin and owner email; fail closed without configuration. Same-origin mutations also require a custom header. No password store or client secret is introduced.
- Use a dependency-free one-edit/transposition search matcher instead of planned Fuse.js; the same copy must satisfy combined filters. Shared Zod schemas validate both form and API inputs.
- Catalog and physical-copy identities remain separate. Creation uses an idempotency UUID plus payload digest; stale edits conflict; intentional duplicate copies get independent UUIDs. Shared manga edits invalidate other affected copy versions.
- Metadata is owner-reviewed. MangaDex volume/locale matches still require physical publisher/edition confirmation. Open Library and CAA release-group covers are explicitly representative. The iTunes fallback supplies digital metadata only; promotional artwork is not imported. MangaDex artwork is always proxied; selected MangaDex/CAA files cache in R2.
- Imports use private previews, source provenance, revision checks, staged visibility, stable identities and server-discoverable resume/cancel. JSON is a full relational backup including samples; default CSV excludes samples. Restores reject conflicting IDs rather than overwrite current edits. R2 bytes remain a separate backup.
- The automated cover utility applies artwork without review only from unambiguous evidence: one exact-name MangaDex title with compatible credits (authors and artists), and exactly one cover with the owned printed volume number and language. Failing that, it uses an Open Library edition whose title is the series plus that volume number, in that language, with a matching publisher/imprint or no listed publisher. Selected Open Library covers are now cached in R2 because archive.org delivery is intermittently unavailable. This revises the earlier external-only default and stays bounded to the owner's covers. Google Books was evaluated, but keyless requests share an exhausted global quota; it would need an owner API key. Retail sites are not scraped. Such art is stored as not owner-selected, with an attribution asking for publisher confirmation. Representative, other-language or ambiguous art, and every CD edition, are left for owner selection. It never replaces existing artwork and checkpoints through existing tables, so the schema is unchanged.
- Light novels and books are an edition-run `medium` (manga / light_novel / book), added by the reviewed additive migration `0001_edition_medium` (`ALTER TABLE … ADD COLUMN … CHECK`). Drizzle Kit's proposed table rebuild was replaced because it would copy a non-existent column and relies on foreign-key pragmas that D1 does not honour. Books reuse the volume subtype instead of a new `media_kind`, which would need `collection_items` and its subtype constraints rebuilt. The UI shows books as their own category. At the owner's request, light novels stay within Manga with a badge and filter, and *86*, *Bakemonogatari* and *Three Days of Happiness* were reclassified in the local collection. Medium is part of new edition identities; manga identities are unchanged.
- `jose` 6.2.13 is the only added runtime dependency. The Astro/Pages major-version choice is preserved. Existing audit findings and hosted quotas/configuration remain release gates. Full workflows and limits: [STAGE3.md](STAGE3.md).

## Stage 1 execution adjustments

- Initial registry restrictions were resolved during Stage 1 completion. The lockfile, clean `npm ci`, full type check, and Astro build are verified. Astro 5.18.2 / Cloudflare adapter 12.6.13 retain Pages compatibility. Drizzle ORM 0.45.4 fixes the reported identifier-escaping advisory. Wrangler 4.151.3 and matching Workers types resolve peers normally; the adapter separately retains its pinned Wrangler 4.59.2. Both runtime paths pass local checks. The audit remains nonzero; see TESTING.md for unresolved upstream advisories and the required platform/version decision before release.
- The TypeScript ingestion and SQL test harness run without third-party dependencies on Node 22.18+. A tested RFC 4180 state machine replaces a package parser; `node:test` replaces Vitest for the foundation suites. A small in-process runner avoids this sandbox's child-process restriction. These changes preserve the normalization contract.
- Node SQLite is an explicitly selected offline verification target, never an application fallback. The Astro repository remains Drizzle/D1-only. The local workerd test is separate and reports missing Wrangler as a failure, not a skipped success.
- The initial SQL migration was authored offline alongside the typed Drizzle schema. Drizzle Kit parity is now verified, and its reviewed snapshot/journal are established under `drizzle/meta/`. Generation uses this history and reports no schema changes. The existing baseline is unchanged; no second baseline is applied.
- Commands needing Astro/Wrangler user-configuration writes required execution outside the restricted sandbox. Actual local D1, Astro, and built Pages HTTP checks now pass. The diagnostic remains a separate private SQLite verification aid.

## Decision record

| ID | Decision / assumption | Reason and consequence |
| --- | --- | --- |
| D01 | Project: Atelier Strawby. Product display: Strawby Stacks — The Strawby Library. | Preserves both the user's project name and the PRD branding. Configurable in one place. |
| D02 | Use `initial_collection.csv` as the original seed, with an input-path option. | The long filename in the PRD is absent; the available file has exactly 177 parsed data records. Keep it unchanged. |
| D03 | Match corrections by semantic identity, not row number. | PRD numbers are generally zero-based; actual audit numbers are one-based excluding header. Absolute positions are brittle. |
| D04 | Keep Astro 5 + a tested 12.x Cloudflare adapter on Pages. | Current adapter upgrades remove Pages support. Lock the compatible versions; treat eventual Astro/Workers migration separately. |
| D05 | D1 immediately, Drizzle for schema/query types and reviewed SQL migrations. | The domain has real relationships and duplicate ownership. Static JSON alone would create avoidable mutation/rebuild consistency problems. |
| D06 | Single owner, private library by default, Cloudflare Access. | Notes contain personal memories and the PRD requests management, not public sharing. No custom passwords or multi-tenant model. Credentials/hostname are deployment inputs, not necessary planning questions. |
| D07 | Separate bibliographic works, edition runs/releases, and owned items. | Language/publisher/numbering belong to editions; notes and dates belong to copies. Prevents destructive deduplication and wrong gap detection. |
| D08 | Retain one ownership record per CSV record; unknown dates stay null. | Satisfies the explicit 177-record invariant without inventing acquisitions or silently collapsing omnibus entries. Physical packaging can be reviewed later. |
| D09 | Only specified language mappings are authoritative; others default EN with provenance. | Spreadsheet language-color information is absent from the CSV. There are 163 assumed EN rows. Kadokawa alone is not a sufficient language rule. |
| D10 | A blank note ends an active cascade; a date change inside explicit markers does not. | Resolves unspecified blank behavior while preserving a real box-set cascade crossing 2022-08-14/17. Original dates remain distinct. |
| D11 | Do not merge related franchises beyond the specified alias map. | Fruits Basket: Illustrations is a separate work. Avoid title-similarity deduplication of manga, novels, artbooks, and adaptations. |
| D12 | Gap detection defaults to internal holes within one edition run. | Different languages/omnibus editions have different numbering. Offer “from volume 1” explicitly; never invent the next unreleased volume. |
| D13 | Four sample CDs, visibly marked and excluded from personal aggregates/exports by default. | The PRD explicitly requests demonstration CDs. They are documented sample data using real application storage and components, not stand-ins for functional import or editing. |
| D14 | Discogs import means its user-exported collection CSV. | Meets the requested CSV/Discogs ingestion with no account-sync dependency. Direct API synchronization is a separate feature and is not promised. |
| D15 | Provider metadata is a suggestion until accepted or unambiguously matched. | Title matches are insufficient for edition cover/tracklist identity. Local corrections and owner edits outrank remote refresh. |
| D16 | R2 stores eligible persistent cover bytes; D1 stores references and provenance. | The deployment filesystem and edge cache are not durable mutable object stores. R2 is an additional required hosted resource for persistent image caching. |
| D17 | Caching policy varies by source. | Open Library prefers direct cover URLs for public display; Apple and Discogs impose their own conditions. Do not treat all downloadable bytes as freely rehostable. |
| D18 | One interactive React island per major page flow. | Shelf/search/dialog state stays coherent without introducing a global state framework or converting the whole site into a client-only app. |
| D19 | Fuse.js for actual fuzzy search; CSS/SVG for simple charts. | A small fuzzy-search dependency adds concrete value. A large chart or animation framework is unnecessary for these views. |
| D20 | No durable background queue in the initial five stages. | Bounded interactive lookups and a resumable CLI utility satisfy enrichment at this collection size. Work resumes on the next request/utility run; always-running enrichment would require an additional worker/scheduler. |
| D21 | JSON is lossless backup; CSV is a portable ownership view. | Relational credits, tracks, aliases, and provenance cannot all fit naturally into one flat CSV. R2 image bytes need separate backup. |
| D22 | Do not install dependencies, create schema/scripts, or build UI in the planning stage. | The user explicitly requested analysis before implementation. Only project planning documents are written now. |

## Risks and concrete responses

| Risk | Impact | Response / verification gate |
| --- | --- | --- |
| Astro 5 / current adapter / Pages mismatch | A default latest install may target Workers and break the deployment requirement. | Stage 1 locks and tests compatible packages. Check security support before release; if a needed fix requires a major upgrade, document a platform/version decision rather than silently switch. |
| Provider title vs. owned publication mismatch | MangaDex/AniList entries may describe another adaptation; imported titles alone lack ISBNs. | Score title+creator+language+volume+format, offer candidate review, record uncertainty, and support manual entry/art selection. No guarantee of 100% exact volume art. |
| MangaDex documentation/API availability unverified | Preferred manga provider could be unavailable or change its contract. | Stage 2 must check live documentation and integration. Use the specified Open Library/AniList alternatives within their capabilities, and keep fallback art working. |
| MangaDex/CAA image rights differ from metadata availability | API accessibility does not itself establish blanket rehosting rights. | Store attribution/source and a provider policy version; verify source-specific permitted delivery before enabling persistent cache. Allow external or typographic fallback where caching is inappropriate. |
| Open Library is unsuitable for uncontrolled cover harvesting | Its guidance discourages cover crawling and asks for direct URLs on public pages. | Use bounded user-triggered metadata/edition lookup; direct cover delivery by default; never run the bulk cache utility against prohibited endpoints. |
| MusicBrainz limits are shared beyond one request | Multiple islands/instances or Cloudflare egress traffic can produce throttling. | D1-coordinated provider lease, meaningful User-Agent/contact, conservative spacing and Retry-After/backoff. Cache accepted metadata and do not poll needlessly. |
| CAA missing covers/thumbnails or redirects | An exact release may have no art even when track metadata exists. | Validate redirects, attempt supported available variants, distinguish release-group art, preserve a fallback and retry state. |
| AniList is series-level | Its representative cover and volume total cannot identify all physical editions. | Use it for aliases/series metadata only by default. Do not claim volume-specific cover success from its series image. |
| iTunes digital vs. CD and promotional-use conditions | Artwork or tracks may not match a physical edition; display conditions affect UX. | Optional disabled provider; retain MusicBrainz/CAA as the main path. Enable only with a compliant presentation and clear edition distinction. |
| Discogs direct API conditions and changing availability | Live API usage introduces attribution, freshness, access, and caching obligations. | Implement exported-CSV import first. Evaluate a live API feature separately without implying that API restrictions vanish merely by copying its content. |
| CSV publisher/language ambiguity | Some imported publisher credits may not identify the physical regional edition. | Preserve source publisher values except named PRD fixes; language provenance and review warnings prevent fabricated confidence. |
| Omnibus counts vs. physical book counts | Steins;Gate's three rows may describe components of a single package. | Preserve 177 imported records, explain the count basis, and flag uncertain numbering. Do not collapse records without evidence. |
| Blank notes / orphan examples disagree with actual context | PRD examples called orphan terminators have real notes immediately before them in the supplied file. | Apply the stated generic exception, test synthetic true orphans, and preserve actual results. Do not force a fabricated orphan into the data. |
| Date and timezone errors | Using JavaScript UTC Date conversion can shift an acquisition by one day. | Validated calendar strings, no timezone conversion; test mixed zero-padding and null dates. |
| D1 API limits and transaction assumptions | Large imports can exceed limits; generic ORM transactions may not map to D1. | Bounded D1 batches, staged visibility, explicit retry/finalization, real Wrangler integration checks. No all-or-nothing guarantee across several independent batches. |
| R2/D1 cross-resource writes | An image upload and metadata update cannot be atomically committed together. | Immutable upload before reference, old-cover retention on failure, report unreferenced assets conservatively. |
| Private notes in static output, search payloads, or exports | Public assets or preview origins could expose the collection. | Private SSR and authenticated APIs; no seed/search-index exports under `public/`; verify custom, Pages, and preview origins. |
| Access and CSRF configuration omitted until release | A hidden edit button is not authorization. | Implement server checks before hosted mutation/import routes exist; fail closed on absent configuration. Validate origin and CSRF token. |
| Concurrent edits and repeated imports | New copies may duplicate accidentally or owner edits may be lost. | Version checks, idempotency keys, stable import identities, and changed-file reconciliation preview. |
| Five-item bottom nav and tiny spines | Small screens/zoom can create inaccessible controls. | Short visible labels, full accessible names, safe areas, preferred 44 px targets, selected-spine expansion, 200% zoom and keyboard checks. |
| Many covers and font families | Heavy image/font requests can erase Astro's performance benefit. | Fixed image dimensions, provider thumbnails, lazy-loading, limited self-hosted fonts, one page island, measured bundle/runtime budgets. |
| No original repository or app scaffold exists | There are no current working features or existing CI to preserve yet. | Stage 1 establishes source-control readiness and checks; later stages preserve all passing behavior. Planning must not claim a Git diff/commit. |

The deployment-version risk is supported by [Astro's current adapter migration notes](https://docs.astro.build/en/guides/integrations-guide/cloudflare/). Provider constraints are documented in [Open Library cover guidelines](https://openlibrary.org/dev/docs/api/covers), [MusicBrainz rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting), [CAA responses](https://musicbrainz.org/doc/Cover_Art_Archive/API), [AniList Media fields](https://docs.anilist.co/reference/object/media), [Apple Search API conditions](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html), and [Discogs API terms](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use).

## Dependencies to supply at the relevant stage

No unanswered question prevents this architectural plan. Before hosted verification, supply/configure the Cloudflare account, Pages project, separate D1/R2 resources, hostname, owner Access policy, and provider contact identity. These are setup dependencies, not assumptions that an account or subscription has already been provisioned. Costs and quotas must be checked against the selected plan at deployment.

Before approving uncertain catalog matches, edition language, ISBN/catalog number, or physical packaging can be refined incrementally using the editor. Such refinements must preserve original import provenance and ownership identity.


## Revised Stage 2 UI decisions (2026-10-21)

The user's current Stage 2 request supersedes the original metadata-first ordering. Build the visual shell and browsing on Stage 1 D1; reserve remote artwork, full mutations and import/export for Stage 3. Preserve the schema, migrations, seed identities, normalization and prior tests.

Use a single server-rendered React island with typed read DTOs and a private read-only refresh endpoint. Keep the original counts page at `/foundation`; the foundation smoke command targets that route. URL parameters retain media/view/search/filter/detail state. Theme storage is optional and failure to access it does not block browsing.

Use original locally served Google Fonts WOFF2 subsets with bundled OFL notices. Covers are explicit typographic placeholders built from real titles/credits. Do not invent illustrations, cover matches, CD catalog metadata or tracklists. Use native modal dialogs with explicit Tab wrapping, Escape and trigger-focus restoration; responsive CSS changes the same content into a mobile bottom sheet.

All collection reads retain the existing local-only authorization and private/no-store headers. No hosted authentication, deployment or dependency major upgrade is included in this UI stage. Existing security findings remain open.
