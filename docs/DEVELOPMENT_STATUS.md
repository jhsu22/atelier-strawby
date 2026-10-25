# Development assessment — 2026-10-24

**Current status: Stage 5 local release QA is complete; hosted production sign-off is blocked.** See [STAGE5.md](STAGE5.md) for current results, [REQUIREMENTS_MATRIX.md](REQUIREMENTS_MATRIX.md) for scope, and [DEPLOYMENT.md](DEPLOYMENT.md) for operations. The sections below retain historical Stage 1–4 evidence; their counts/advisory totals are not the current release assessment.

**Current stage: Stage 4 is implemented.** Timeline, analytics, counting rules and the strengthened gap detector are described in [STAGE4.md](STAGE4.md). The application can add, edit and delete manga volumes and CDs, then reload and read the persisted result from D1. The established schema, migration, seed importer, source CSV and visual design are preserved. Hosted production readiness is not claimed.

## Stage 4 verification

Stage 4 preserves the source CSV, schema, migrations, importer and owner-edited records. The diary and analytics derive from the live D1 library payload. Independent SQL and original CSV checks run in SQLite and real workerd D1. `npm run verify:insights` also checks the current owner-edited local D1 without resetting it: 177 manga/LN copies, 38 series, nine light novels, one personal CD and one book; EN 164 / JP 12 / KR 1. The original baseline is tested separately.

Stage 4 checks passed: 65 unit, 33 SQLite integration and six real D1/R2 tests; all 42 desktop/mobile browser scenarios passed across the full run and corrected timeline rerun. Astro/TypeScript checks and the Pages build pass. Current verification details are recorded in the Stage 4 guide. The Stage 3 table below remains historical evidence for that stage.

## Released-volume lookup follow-up

Series details now expose edition-specific released-number lookup and missing copies with source links, pagination/continuation, publication-date checks, cached snapshots and current-ownership comparison. Google Books precedes Open Library for automatic metadata fallback. A live owner-key lookup of the English *Girls' Last Tour* edition found 1–6 and missing 2–5; only derived caches were changed. See [RELEASED_VOLUMES.md](RELEASED_VOLUMES.md) for scope and limitations. Follow-up validation passed 68 unit tests, 42 integration tests, seven real D1/R2 tests and 48 full-suite desktop/mobile browser scenarios; type checks and the Pages build pass.

## Implemented

- Stage 1: deterministic original CSV normalization/import, 27-table relational schema, D1 persistence, provenance, duplicate-copy identities and sample exclusion.
- Stage 2: responsive shelf/details, cover and spine views, edition-aware gaps, URL state, light/dark themes and collection statistics.
- Stage 3: reviewed MangaDex/Open Library metadata/artwork and MusicBrainz/CAA release lookup, explicit fallbacks, D1 cache/provider throttling and private R2 artwork; fuzzy search and combined smart filters; editable memory tags; validated persistent manga/CD CRUD; original manga/CD/Discogs CSV preview/import/resume/cancel; CSV export and full JSON backup/restore; owner-only Access JWT verification and same-origin mutations.
- Pre-approval audit (2026-10-23): import duplicate detection now distinguishes medium, so a book is not a duplicate of a same-titled manga or light-novel copy; this has a regression test. Drizzle Kit reports no pending schema changes. `npm run test:smoke` asserts the original baseline (EN 167 / JP 9), so it was run against a freshly seeded built worker (`STRAWBY_TEST_PORT=4398 node scripts/browser-server.ts`) and passed. It fails against the owner-edited dev collection for the same reason as `verify:seed`.
- Light novels (badge and filter within Manga) and a separate Books category (add, Open Library lookup, cover utility, Books tab, drawer and author shelf), via the additive migration `0001_edition_medium`. The local dev collection was migrated (backup taken first), and *86*, *Bakemonogatari* and *Three Days of Happiness* were reclassified as light novels, which cleared their automatic manga covers. A scratch run then matched all nine light-novel volumes and *Project Hail Mary* to the correct Open Library editions (visually checked). `npm run verify:seed` now reports the owner's own earlier language edits (164 EN / 12 JP vs. the 167 / 9 baseline) and the removed sample CDs. It checks an untouched seeded baseline, not an edited collection.
- Stage 3 completion pass: the resumable automated cover utility (`npm run covers:cache`) specified in the architecture is implemented. It fixes a cover-identity bug in R2 caching, and a browser stale-edit test was added.
- The development baseline remains **177 manga copies across 38 series**. Sample CDs were removed on 2026-10-24 (migration `0005_remove_sample_cds`); tests that need CDs seed plain test-only CDs. Test mutations run on disposable stores.

Usage, authentication configuration, provider policies, import templates, live evidence and limitations are documented in [STAGE3.md](STAGE3.md).

## Verification

Environment: Node 26.11.1, npm 12.2.1, pinned dependencies, Linux Chromium. Stage 3 adds pinned `jose` 6.2.13; the Astro/Pages major versions are unchanged.

| Check | Result |
| --- | --- |
| `npm run validate` | PASS: checking reports 0 errors, 0 warnings, 1 existing hint; **57 unit + 32 integration tests**; production Pages build. |
| `npm run test:d1` | PASS: **5 real workerd D1 tests**, including the light-novel/book medium scenario, the shared CRUD/import/restore scenarios, closing/reopening persistent D1, and the cover-utility scenario with real local R2 across a restart. |
| `npm run test:e2e` | PASS: **34 desktop/mobile Chromium tests** (run with `STRAWBY_TEST_PORT=4399` while a dev server used 4321) against a newly built worker and disposable seeded D1/R2, including accessible forms, provider failure/manual entry, manga/CD add/edit/delete with reloads, stale-edit conflict recovery, full-bleed loaded artwork with typographic fallback on failure, filters, imports and backups. |
| Cover utility (live) | MangaDex only: 35/176 volume editions. With the Open Library edition fallback, on a copy of the dev state: 92/176 editions (93/177 copies), 26/38 series with shelf art; 56 Open Library covers cached in R2, 1 retained externally after archive.org 503s; covers visually confirmed. |
| Targeted transfer browser rerun | PASS: 2 desktop/mobile import/export tests after the final multi-label CSV correction (10.6 seconds). |
| `npm run test:schema` | PASS: reviewed 27-table schema, snapshot and migration parity; none changed in Stage 3. |
| `npm run verify:seed` | PASS: 177 manga / 38 series, 172 dated / 5 undated, 97 notes, four excluded sample CDs. |
| `npm run test:smoke -- --url http://127.0.0.1:8791` | PASS: built Pages foundation counts, React SSR, stylesheet, private headers and nonlocal Host rejection. |
| Visual review | Manga/CD editors fit 320, 768 and 1440 px without document/dialog horizontal overflow; narrow light and desktop dark screenshots inspected. |
| Live integration | Selected real MangaDex volume and MusicBrainz/CAA multi-disc edition saved in disposable D1, image bytes cached in real local R2, then data and objects verified after runtime reopening. |
| `npm audit --json` | **13 affected-package findings: 6 moderate, 6 high, 1 critical** remain from the established stack. |
| Preservation | Original source CSV, typed schema, migrations and deterministic importer unchanged; baseline persisted collection verified. |

Provider fixtures test timeouts, malformed JSON, missing artwork, rate limits, cache reuse and forced retry without depending on live services. Auth fixtures verify signed JWTs, wrong owners/issuers/audiences, expiry, forged tokens, origins and body limits. SQLite and real D1 execute the same mutation/import scenarios. Stale shared-series edits and changed idempotency retries are rejected.

Logs are ignored local `/tmp/strawby-stage3-*.log` files; reports, live probes and screenshots stay under ignored `data/generated/`. These are local verification artifacts, not deployment inputs.

## Remaining work and boundaries

- Provision isolated hosted preview/production D1/R2, owner Access policy and exact origin/audience. Test actual hosted authentication, direct-origin rejection, provider access, quotas, persistence and R2 delivery. Hosted writes remain closed without configuration.
- Resolve the existing dependency/platform advisories before public deployment. Audit severity identifies affected packages; it does not establish exploitability in this application. A platform major upgrade is a separate decision.
- Verify Safari/Firefox, physical devices, screen-reader operation, Node 22 and hosted performance. Chromium emulation is not physical-device coverage.
- The cover utility only opens local Wrangler state; hosted enrichment needs separately verified credentials. Volumes without a MangaDex or Open Library edition cover remain typographic until the owner selects artwork in the editor. Google Books now has an owner-configured key and a live lookup has been verified. Its representative artwork remains a reviewed editor option.
- Provider matches require review. Manga volume/locale alone does not establish the physical publisher; Open Library work art, CAA release-group art and iTunes digital metadata remain clearly distinguished fallbacks. R2 image bytes need separate backup; JSON preserves references.

The original workflow scope was absorbed into Stage 3. Timeline/analytics are now implemented in Stage 4; hosted release requires its own verification gates.
