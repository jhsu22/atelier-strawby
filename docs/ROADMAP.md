# Requirements and five-stage implementation plan

Status as of 2026-10-21: **Stage 1 local functional acceptance passes; dependency security advisories remain documented. Stages 2–5 have not started.**

Authority: [project_specification](../project_specification), supplemented by the user's engineering and development-discipline requirements. Design: [ARCHITECTURE.md](ARCHITECTURE.md), [DATA_MODEL.md](DATA_MODEL.md). Evidence: [TESTING.md](TESTING.md). Assumptions and risk responses: [DECISIONS.md](DECISIONS.md).

Implement one stage at a time. At each start, restate dependencies and acceptance criteria; at each finish, report files changed, features implemented, actual commands/checks and results, limitations, remaining work, and the recommended next stage. Passing a local check does not mean a hosted integration is verified. Keep these documents updated as decisions change.

## Dependency sequence

```mermaid
flowchart LR
  P[Planning complete] --> S1[1. Foundation and deterministic ingestion]
  S1 --> S2[2. Read services, metadata, and cover cache]
  S2 --> S3[3. Responsive browsing and detail]
  S3 --> S4[4. Editing, imports, and portable backups]
  S4 --> S5[5. Timeline, analytics, and production verification]
```

Migration, authentication, loading/error behavior, accessibility, and regressions are part of each relevant stage. They are not all postponed to the final stage. Optional provider alternatives are retained as documented alternatives, not silently dropped required features.

## Stage 1 — Foundation and deterministic ingestion

**Execution status (2026-10-21):** all eight local functional acceptance criteria below pass. Clean locked installation, full checking/build, 38 unit + 17 integration + 2 actual D1 tests, schema parity/snapshots, local D1 migration/repeat seed and Astro/built Pages smoke are verified. The [Stage 1 audit](STAGE1_AUDIT.md) also verified empty/unavailable D1 responses and fixed private database path handling. Dependency audit remains nonzero (including an upstream critical advisory); hosted/security-release readiness is not claimed. Stage 1 scope is retained. See [STAGE1_VALIDATION.md](STAGE1_VALIDATION.md).

**Dependencies:** original specification and CSV; available Node/package tooling; the documented normalization decisions. Hosted Cloudflare credentials are not needed for a local start.

**Deliver:** Astro 5/React/Tailwind/Lucide/strict TypeScript scaffold with tested Pages-compatible versions; D1 schema and reviewed migrations; `scripts/seed-from-csv.ts`; deterministic normalized artifacts/audit report; local D1 seed and read smoke check; four clearly labeled sample CD definitions; environment separation and authentication configuration boundary; README and baseline checks.

**Acceptance criteria:**

1. Package install, Astro/TypeScript checks, and a Pages-compatible production build succeed. Local Wrangler can read the configured D1 binding. Node-only parser dependencies are absent from the deployed runtime graph.
2. A real CSV parser reads all **177** data records and ignores the actual empty-headed legend columns. Normalization produces **38** canonical series without altering the input file hash.
3. Every required typo/author/publisher correction, language mapping, original edition title, and cascade rule has an assertion. Preserve both repeated Vol 1 ownership records. Assertions include the source's actual two-backslash terminators, blank notes, and orphan-marker edge cases.
4. Audit totals match 172 dated/5 undated records, yearly counts 21/96/26/29, and 167 EN/9 JP/1 KR with explicit language provenance. Report 97 resolved notes and the date-crossing box-set cascade accurately.
5. Seeding twice creates no extra owned copies and does not overwrite an intervening owner edit. Changed-file import is refused for automatic reconciliation and emits a preview requirement.
6. Local D1 foreign-key and subtype integrity checks pass. Domain lists are normalized, and duplicate ownership is permitted by constraints.
7. Four CD demonstrations have `is_sample=true`, known source provenance, and nullable unverified metadata. No invented tracklists, catalog numbers, or acquisition dates. If a sample release is not yet resolved, that state is explicit.
8. README documents local commands, source filename discrepancy, seed targeting, preview/production separation, and required bindings. All check commands used are recorded in TESTING.md.

**Stage boundary:** no complete shelf/editor UI or external metadata success claimed. Output is a working local foundation and real seed, not a finished application.

## Stage 2 — Read services, metadata, and cover caching

**Dependencies:** Stage 1 verified; local D1/R2 bindings; provider documentation/availability; identifying application contact for APIs requiring it. Hosted smoke checks additionally need isolated Cloudflare resources and Access configuration.

**Deliver:** typed read DTOs/endpoints; Access enforcement for hosted data; MangaDex preferred lookup with verified fallback behavior; MusicBrainz + CAA exact release/tracklist integration; D1 metadata cache and shared throttle; R2 cover storage and serving; resumable `scripts/cache-covers.ts`; metadata/covers failure reports; sample CD release resolution.

**Acceptance criteria:**

1. Real D1-backed collection/detail responses validate against their contracts; no API returns hardcoded library content. Unauthorized hosted access fails, including direct-origin/preview routes.
2. Document the live MangaDex contract, permitted cover use, and observed availability. Perform representative manga lookups, including an alternate title and a volume/language distinction. If unavailable, exercise the approved alternative and explicitly report MangaDex as unverified/unavailable.
3. Resolve a real CD release with media/tracklist data from MusicBrainz and its exact-release artwork from CAA when available. Resolve the four sample CDs, or retain honest missing metadata with evidence; no fabricated success response.
4. Candidate selection distinguishes exact edition/release matches from representative images. An ambiguous match never silently changes confirmed author, publisher, language, notes, or acquisition date.
5. Cache an eligible real image in R2, retrieve it after a fresh server process, and confirm repeated requests reuse it. Providers requiring direct image delivery are recorded as external sources rather than covertly rehosted.
6. Provider requests share a throttle across concurrent requests; verify MusicBrainz spacing, timeout/429/503 handling, response validation, and negative-cache behavior. A cache hit makes zero upstream calls.
7. The utility resumes after interruption, reports eligible/matched/missing/failed counts, and does not fail the application build when providers are unavailable. Runtime requests remain bounded; no unsupported background durability is claimed.
8. Invalid image type, excessive size, disallowed redirect, and missing/corrupt image are handled safely. Fallback data is available for every owned record regardless of provider coverage.

**Stage boundary:** record actual coverage percentages and unresolved editions. Complete cover coverage is not an acceptance requirement because providers may lack the edition. A tested, working integration and honest fallback are requirements; recorded test fixtures do not replace live checks.

## Stage 3 — Responsive shelf, search, and detail

**Dependencies:** Stage 2 typed read services, provider outcomes, and cover service; Stage 1 real collection.

**Deliver:** boutique visual tokens, light/dark theme, responsive shell and navigation, media switcher, cover and spine views, series/album drawers and direct detail pages, fuzzy search, smart filters and memory tags, gap detector, sample CD display.

**Acceptance criteria:**

1. Shelf shows all 177 manga records grouped into 38 series, plus four labeled sample CD records in the sample-enabled view. All Media/Manga/CD switching and artist/album grouping work on real DTOs.
2. At 360/390 px mobile widths, show 2 columns or an explicitly selected usable compact density, all five bottom-navigation actions, and safe-area spacing. At 1280–1440 px show 5–7 columns as appropriate. No document-level horizontal overflow; only intended pill/spine rows scroll sideways.
3. Cover/spine switching preserves search/filter state. Spines represent each owned copy and support keyboard and touch selection. Book/CD shapes and jewel-case/obi details remain distinct.
4. Series detail shows authors, edition publishers, languages, owned counts, numerically ordered individual volumes, date/unknown-date state, edition tags, and expanded personal notes. JP/KR variants and duplicate copies remain visible.
5. CD detail shows real or explicitly unknown artist/year/label/format/catalog metadata, ordered media/tracklists, and per-owned-copy notes. Jewel-case interaction is keyboard operable and respects reduced motion.
6. Gap tests include synthetic 1–3/7 → 4–6, actual 86 → 5–6, duplicate numbers, different languages, and uncertain omnibus numbering. No cross-edition or future-volume false gaps.
7. Fuzzy search returns a matching title for an intentional typo; alternate/native titles, author/artist, publisher/label, and resolved notes are searchable. Combined filters follow documented item-level AND/OR semantics. All five required memory-tag categories are available where data supports them.
8. URL state survives refresh and back/forward; direct detail routes render without an already-open shelf. Dialog focus is trapped/restored, Escape works, and labeled navigation/controls pass automated checks plus keyboard review.
9. Verify light/dark, reduced motion, missing image, missing detail, no results, empty collection, loading, and failed fetch states. Target zero serious/critical axe findings on covered pages and WCAG AA contrast for text/controls.
10. On a recorded 1,000-item fixture and defined test machine/browser, local search+filter processing has p95 below 100 ms after hydration, excluding intentional debounce and network. Measure, record, and address failures; do not add virtualization without evidence.

**Stage boundary:** unfinished Add, Timeline, and Stats destinations must be clearly identified as upcoming during this incremental stage; no fake save/analytics actions. They become functional in Stages 4–5.

## Stage 4 — Add/edit, imports, and portable backups

**Dependencies:** Stages 1–3; authenticated mutation boundary; versioned schema and stable item IDs; metadata resolution and working dialogs/forms.

**Deliver:** functional manga/CD add/edit routes and modal flow; autocomplete with manual override; runtime validation and optimistic-concurrency handling; generic CD CSV import and Discogs-export CSV mapping; preview/commit/retry flow; CSV/JSON exports; restore utility.

**Acceptance criteria:**

1. Create and edit a manga copy and CD copy; each persists across refresh and a separate browser session. Changes update shelf/search/detail/counts without a deployment rebuild.
2. Add the same edition twice intentionally and retain two copies. Repeated submission of one idempotency key produces one copy. A stale edit produces a 409 conflict with recoverable input rather than silently overwriting changes.
3. Autocomplete uses real providers/cache, displays edition candidates, and lets the owner complete a manual save while providers are offline or throttled. Failed saves preserve fields and show actionable errors.
4. CSV imports handle quoted commas, embedded newlines, UTF-8/BOM, missing optional fields, invalid fields, and duplicates. Preview identifies every rejected/warned row before commit. Column mappings and preview hashes are retained with the import audit.
5. Import a representative Discogs collection export with artist, title, label, catalog number, format, year, release ID, and custom notes. Preserve source fields for unmapped values. `Date Added` is not acquisition date unless the owner explicitly maps it. No Discogs API token is needed for this file import.
6. A partially failed import does not become a partially visible collection. Retrying resumes by record identity; finalization verifies expected count/references. Re-import of the identical file does not duplicate owned copies; changed-file candidates require review.
7. JSON export→restore into a fresh local D1 preserves IDs, aliases, multiple credits, editions, owned copies, notes, tags, null dates, tracks, and cover references. CSV output has proper quoting/Unicode and documented spreadsheet formula protection. Sample records are excluded by default and selectable explicitly.
8. Unauthorized, cross-origin, invalid, and oversized mutation/import requests fail safely. No private export is available from a static public asset or public cache.
9. End-to-end add→lookup/manual entry→save→edit→export tests pass for both media types, with API failure and stale-edit scenarios.

**Stage boundary:** direct Discogs account sync is not included; the PRD's Discogs import is fulfilled through its collection CSV export. Image binaries are a separate R2 backup; JSON contains references and provenance.

## Stage 5 — Haul timeline, analytics, and production verification

**Dependencies:** Stages 1–4; reliable persisted edits/imports; final Cloudflare account resources, owner identity and target hostname for hosted checks.

**Deliver:** date-grouped haul timeline and unknown-date section; live analytics and accessible charts; completed navigation; Pages deployment scripts/configuration; migration, rollback, backup/restore, observability, and operating documentation; full regression and hosted smoke checks.

**Acceptance criteria:**

1. Baseline timeline includes 5 records on 2021-10-27 and 19 on 2022-12-25, preserves their resolved memories, and shows 5 undated items separately. The date-crossing box-set note does not merge different acquisition dates.
2. Baseline stats show 177 owned manga records, 38 series, the documented publisher counts, and yearly values 21/96/26/29 plus 5 unknown. Queries derive these numbers; edits/imports change them. Top-author handling and multi-credit counts are explained; sample CDs never inflate personal metrics.
3. Every PRD feature in the traceability table below is verified or explicitly identified as incomplete. Charts expose equivalent tabular data. Mobile navigation, forms, dialogs, scroll, focus, dark mode, and all state variants pass final review.
4. Fresh checkout→install→migrate local D1→seed→checks→build→local Pages runtime succeeds using the README. Production and preview bindings are distinct. Dependency/compatibility versions are locked and documented.
5. Deploy to an isolated hosted preview and verify authentication, direct-origin protection, D1 persistence, R2 cover reuse, real lookup, exports, and cold/restarted requests. Production uses the verified configuration and gets its own post-deployment smoke check. A local build alone cannot satisfy this criterion.
6. On a recorded production-like mobile Lighthouse run, target performance ≥90, accessibility ≥95, LCP ≤2.5 s and CLS ≤0.1 for the representative seeded shelf. Record runtime, network/cache conditions, and run variability; fix material issues rather than presenting unmeasured guarantees.
7. Exercise migration recovery on a disposable database and a backup restoration from the current JSON/SQL and R2 inventory. Demonstrate that rolling back a deployment alone does not roll back D1, and document compatible migration sequencing.
8. Review logs for useful request/provider/import failures without personal notes or secrets. Verify failure handling during D1/provider unavailability and no accidental production sample seed on redeploy.
9. Required automated suites pass; document manual browser/device coverage and any unresolved risks. Mark production-ready only after hosted checks and all required criteria pass.

If hosted resources are unavailable, complete local deliverables and explicitly leave deployment/production verification incomplete. Do not relabel a local-only result as production-ready.

## Requirement traceability

Stage 1 foundation requirements are implemented and locally verified as recorded above. Remaining features and their evidence are planned for their assigned stages; partial foundation work does not imply a complete later-stage requirement.

| ID | Original requirement | Stage(s) | Evidence needed |
| --- | --- | --- | --- |
| R01 | Astro 5, strict TypeScript, React islands, Tailwind, Lucide | 1, 3 | Version matrix, successful check/build, component review |
| R02 | Cloudflare Pages + D1, deployment/local instructions | 1, 5 | Local bindings, migrations, hosted smoke, README |
| R03 | Deterministic `scripts/seed-from-csv.ts`, all 177 rows | 1 | Source digest, count/identity tests, repeat-seed test |
| R04 | Ignore legend columns and trim every input field | 1 | Actual-header fixture and whitespace assertions |
| R05 | Cascades, terminator clearing, orphan exception | 1 | Every marker resolved; synthetic orphan/date tests |
| R06 | All named title/author/publisher corrections | 1 | Semantic correction fixtures and audit |
| R07 | All multilingual mappings and duplicate ownership | 1, 3 | Group counts, editions/language badges, copy tests |
| R08 | Automated manga/CD cover fetch and caching | 2 | Live provider outcomes, persisted R2 image, resumed utility |
| R09 | Typographic cover fallback under API/image failures | 2, 3 | Provider failure and browser image-error tests |
| R10 | Boutique palette, serif/sans/mono typography, light/dark | 3 | Responsive/theme/contrast review |
| R11 | Five-action sticky mobile nav, pills, mobile/desktop grids | 3, 4, 5 | Viewport and safe-area checks; final action navigation |
| R12 | All/Manga/CD switcher, series and artist/album grouping | 3 | Seeded browse/filter tests |
| R13 | Four to five sample Japanese/soundtrack CDs | 1, 2, 3 | Four labeled samples; real enrichment where available |
| R14 | Grid and virtual manga/CD spine modes | 3 | Per-copy spine selection and state preservation |
| R15 | Mobile bottom sheet and desktop side detail | 3 | One content model; keyboard/focus/back behavior |
| R16 | Series metadata, volume art/date/language/edition/notes | 3 | Detail assertions against normalized data |
| R17 | Missing-volume gap toggle and noncontiguous runs | 3 | Language/format-separated unit and browser tests |
| R18 | Interactive CD jewel case/obi, release details, tracklist | 2, 3 | Exact release mapping, multi-disc and accessible interaction |
| R19 | Fuzzy search across all specified fields | 3 | Typo, alias, creator, label/publisher, note queries |
| R20 | Publisher/language chips and five memory-tag categories | 1, 3 | Deterministic tag rules and combined filter tests |
| R21 | Chronological haul feed with personal notes | 5 | Known date groups, unknown dates, edited acquisition |
| R22 | Manga total, unique series, publishers, years, authors | 5 | Query totals vs. seed and modified data |
| R23 | Quick Add/Edit manga/CD with metadata autocomplete | 4 | Real persistence and provider-unavailable manual save |
| R24 | Actual CD manual entry, CSV and Discogs import | 4 | Real writes, generic/export-file fixtures and preview |
| R25 | CSV/JSON export for local backups | 4, 5 | Quoted Unicode CSV, lossless JSON restoration |
| R26 | Loading, empty, error, fallback, responsive accessibility | 2–5 | State matrix, axe/keyboard/device reviews |
| R27 | Maintain architecture/roadmap/decisions/testing documents | Every stage | Updated status, decisions, actual verification evidence |

## Current handoff

Stage 1 foundation and local functional checks are complete. `README.md` documents locked setup and repeatable checks; `TESTING.md` records actual application/D1/Pages results and unresolved audit findings. No Stage 2–5 feature or hosted deployment was attempted. Resolve the recorded dependency/platform security decision before hosted release; any later-stage implementation remains a separate task.
