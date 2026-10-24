# Development assessment — 2026-10-23

**Current stage: Stage 3 is implemented and locally verified.** The application can add, edit and delete manga volumes and CDs, then reload and read the persisted result from D1. The established schema, migration, seed importer, source CSV and visual design are preserved. Hosted production readiness is not claimed.

## Implemented

- Stage 1: deterministic original CSV normalization/import, 27-table relational schema, D1 persistence, provenance, duplicate-copy identities and sample exclusion.
- Stage 2: responsive shelf/details, cover and spine views, edition-aware gaps, URL state, light/dark themes and collection statistics.
- Stage 3: reviewed MangaDex/Open Library metadata/artwork and MusicBrainz/CAA release lookup, explicit fallbacks, D1 cache/provider throttling and private R2 artwork; fuzzy search and combined smart filters; editable memory tags; validated persistent manga/CD CRUD; original manga/CD/Discogs CSV preview/import/resume/cancel; CSV export and full JSON backup/restore; owner-only Access JWT verification and same-origin mutations.
- The development baseline remains **177 manga copies across 38 series plus four labeled sample CDs**. Test mutations run on disposable stores. Sample release metadata is never silently replaced with a guessed provider match.

Usage, authentication configuration, provider policies, import templates, live evidence and limitations are documented in [STAGE3.md](STAGE3.md).

## Verification

Environment: Node 26.11.1, npm 12.2.1, pinned dependencies, Linux Chromium. Stage 3 adds pinned `jose` 6.2.13; the Astro/Pages major versions are unchanged.

| Check | Result |
| --- | --- |
| `npm run validate` | PASS: checking reports 0 errors, 0 warnings, 1 existing hint; **53 unit + 28 integration tests**; production Pages build. |
| `npm run test:d1` | PASS: **3 real workerd D1 tests**, including the shared CRUD/import/restore scenarios and closing/reopening persistent D1. |
| `npm run test:e2e` | PASS: **28 desktop/mobile Chromium tests** against a newly built worker and disposable seeded D1/R2, including accessible forms, provider failure/manual entry, manga/CD add/edit/delete with reloads, filters, imports and backups. |
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
- Complete the haul timeline and remaining analytics from Stage 5. Timeline still opens its planned-feature panel.
- Verify Safari/Firefox, physical devices, screen-reader operation, Node 22 and hosted performance. Chromium emulation is not physical-device coverage.
- Provider matches require review. Manga volume/locale alone does not establish the physical publisher; Open Library work art, CAA release-group art and iTunes digital metadata remain clearly distinguished fallbacks. R2 image bytes need separate backup; JSON preserves references.

The original Stage 4 workflow scope is absorbed into this revised Stage 3. The next product work is timeline/analytics; hosted release requires its own verification gates.
