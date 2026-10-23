# Requirements and five-stage implementation plan

Status as of 2026-10-23: **Stage 1 is preserved. Stage 2 implements the visual design system, collection browsing, and responsive UI requested by the user. Stage 3 has not started.** The latest user scope supersedes the original stage ordering: remote images, complete mutations, ingestion/editing, and import/export move to Stage 3. Latest assessment and verification: [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md); Stage 2 implementation record: [STAGE2_UI.md](STAGE2_UI.md).

Authority: [project_specification](../project_specification), supplemented by the user's engineering and development-discipline requirements. Design: [ARCHITECTURE.md](ARCHITECTURE.md), [DATA_MODEL.md](DATA_MODEL.md). Evidence: [TESTING.md](TESTING.md). Assumptions and risk responses: [DECISIONS.md](DECISIONS.md).

Implement one stage at a time. At each start, restate dependencies and acceptance criteria; at each finish, report files changed, features implemented, actual commands/checks and results, limitations, remaining work, and the recommended next stage. Passing a local check does not mean a hosted integration is verified. Keep these documents updated as decisions change.

## Original dependency sequence (superseded for Stages 2–3)

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

## Stage 2 — Visual design system, collection browsing, and responsive UI

**Authority:** the user's revised Stage 2 request. The original metadata-first ordering is superseded. See [STAGE2_UI.md](STAGE2_UI.md) for the complete current scope, acceptance comparison, and executed checks.

**Dependencies:** established Stage 1 D1 schema, seeded manga, labeled sample CDs, and the existing Astro/React stack. No remote image provider or hosted deployment is required.

**Deliver:** editorial typography and shared light/dark tokens; responsive application shell and navigation; real D1-backed manga/CD cover and spine browsing; search and filters; mobile bottom-sheet and desktop side-panel details; edition-aware gap detection; honest unresolved CD metadata/tracklist states; accessible keyboard interaction, reduced motion, loading and failure states.

**Acceptance criteria:**

1. The real seeded 177 manga ownership records appear under 38 series. Four labeled demonstration CDs remain separate from personal totals. No source schema or importer changes are required.
2. The grid has 2–3 mobile columns and 5–7 desktop columns, with no document overflow. Individual-copy spines retain duplicates and permit intentional horizontal scrolling.
3. Media, grid/spine, search and filter controls work; refresh and back/forward retain URL state. All five mobile navigation actions are usable. Add and Timeline clearly indicate their upcoming status; existing aggregate stats remain available.
4. Manga details show original edition titles, credits, publishers, languages, acquisition dates/notes and every owned copy. Gap detection compares printed numbering only within the same edition and language; uncertain omnibus numbering does not produce claimed gaps.
5. CD details provide an operable jewel case, known artist/title data, explicit unknown release/format/label/catalog/year fields, an honest missing-tracklist state and sample acquisition information. Future stored tracklists have an ordered rendering path.
6. Theme preference persists, drawer focus is contained/restored, Escape works, reduced motion applies, touch controls are usable and representative accessibility scans pass.
7. Run checks/build, real D1 and foundation regression checks, browser interactions and visual review at mobile/desktop sizes. Record browser/device limitations without claiming unperformed verification.

**Boundary:** no remote artwork APIs, metadata enrichment, mutation API, import/export, authentication migration or deployment. Typographic artwork is an explicit designed fallback. Existing hosted access continues to fail closed.

## Stage 3 — Metadata, artwork, and collection workflows (not started)

The user's updated ordering places remote image APIs, ingestion/editing, full mutations and import/export here. Retain the original matching, caching, throttling, persistence, idempotence and backup requirements in [ARCHITECTURE.md](ARCHITECTURE.md) and [DATA_MODEL.md](DATA_MODEL.md). Establish the exact next-stage acceptance criteria before implementation. None of those integrations is claimed by Stage 2.

The original Stage 4–5 requirement lists below are retained as future-work detail; their numbering does not override the user's revised scope.

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

Stage 1 foundation requirements are preserved. The table below retains the original stage references for historical traceability; the revised Stage 2 UI mapping above and STAGE2_UI.md take precedence. External integrations and mutations remain future work.

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

Stage 1 remains intact and the requested Stage 2 UI is implemented. See [STAGE2_UI.md](STAGE2_UI.md) and [TESTING.md](TESTING.md) for current evidence. The Stage 1 diagnostic is available at `/foundation`. Stage 3 integrations and hosted deployment were not attempted. The recorded dependency/platform security decision remains open before hosted release.
