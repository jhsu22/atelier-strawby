# Development assessment — 2026-10-23

**Current stage: Stage 2 is implemented and locally verified; Stage 3 has not started.** This is a functional local collection browser with a tested data foundation. It is not ready for hosted production use.

## Implemented

- Stage 1: deterministic CSV normalization/import, reviewed 27-table relational schema, D1 persistence, provenance, duplicate-copy preservation, sample exclusion and repeat-import safety.
- Stage 2: D1-backed shelf and refresh API, manga/CD switching, cover grid and individual-copy spines, responsive detail drawers, edition-aware internal volume gaps, search/filters, URL state, light/dark themes and basic collection statistics.
- The persisted local collection contains **177 manga copies across 38 series**, plus **four explicitly labeled sample CDs**. The original CSV, schema, migrations, importer and original normalization/database/D1 test files remain unchanged from the Stage 1 commit.

## Remaining work

| Area | Current boundary |
| --- | --- |
| Artwork and metadata | Typographic artwork placeholders; no external provider lookup, real cover cache or verified sample CD release enrichment. |
| Collection management | Add/edit, mutation APIs, metadata-assisted entry, CD/Discogs import and CSV/JSON export/restore are not implemented. Add opens an explanatory panel. |
| Search | Normalized substring/token matching; typo-tolerant fuzzy search from the original specification is not implemented. |
| Timeline and analytics | Timeline opens an explanatory panel. Current derived counts, languages and publisher statistics do not complete the planned timeline and analytics work. |
| Hosting and access | Reads require explicit local flags and a localhost URL. Hosted requests fail closed; Access JWT verification and provisioned preview/production D1/R2 resources are absent. No hosted deployment was verified. |
| Broader verification | This assessment exercises Linux Chromium desktop/mobile emulation. Safari, Firefox, physical devices, screen readers, Node 22 and hosted performance remain unverified. |

The revised stage sequence in [ROADMAP.md](ROADMAP.md) places metadata, artwork and collection workflows in Stage 3. Its original Stage 4–5 lists retain detailed future requirements; they do not describe completed functionality.

## Checks rerun for this assessment

Environment: Node 26.11.1, npm 12.2.1, installed locked dependencies. A clean installation was not repeated in this assessment; earlier clean-install evidence remains in [TESTING.md](TESTING.md).

| Command/check | Result |
| --- | --- |
| `npm ls --depth=0` | PASS: pinned direct dependencies installed without reported dependency-tree errors. |
| `npm run validate` | PASS: Astro/TypeScript 0 errors, 0 warnings, 1 existing hint; **48 unit + 21 integration tests**, no failures/skips; production build. |
| `npm run test:schema` | PASS: 27-table schema, snapshot and reviewed migration parity. |
| `npm run test:d1` | PASS: **2 real workerd D1 tests**, no failures/skips. |
| `npm run verify:seed` | PASS: 177 personal manga, 38 series, 172 dated/5 undated copies, 97 notes and four excluded sample CDs. |
| `npm run preview:pages -- --port 8788 --inspector-port 9230` | PASS: compiled Pages worker serves the seeded local D1 application. |
| `STRAWBY_TEST_URL=http://127.0.0.1:8788 npm run test:e2e` | PASS: **22 desktop/mobile Chromium tests** against the compiled worker, including accessibility scans, responsive layouts, browsing/details, URL state, gestures and refresh failure/recovery. |
| `npm run test:smoke` | PASS: compiled foundation counts, React SSR, sample exclusion, private headers, stylesheet delivery and nonlocal Host rejection. |
| `npm audit --json` | Exit 1: **13 affected-package findings: 6 moderate, 6 high, 1 critical**. This supersedes the earlier 11-finding count. |
| Source/build hygiene | PASS: original CSV SHA-256 unchanged; no ingestion modules, source CSV, generated collection JSON or checked personal-note strings in built assets; credential-pattern scan found no matches in tracked/candidate files. `.dev.vars`, local databases, generated evidence, dependencies and build output remain ignored. |

Command logs for this assessment are local files matching `/tmp/atelier-strawby-assessment-*`; browser reports and screenshots remain under ignored `data/generated/`. These artifacts are not included in Git.

## Next development priorities

1. Resolve the dependency/platform decision and implement verified hosted authentication before any hosted release. The installed Astro 5/Cloudflare adapter 12 stack has unresolved advisories; the audit also flags Zod and its dependent tooling. Audit severity describes affected packages, not a demonstrated exploit in this application. This assessment does not change dependencies or establish exploitability.
2. Establish Stage 3 acceptance criteria, then implement metadata/artwork and durable add/edit/import/export workflows with authorization, validation and regression coverage.
3. Complete fuzzy search, timeline and remaining analytics, then broader device/accessibility/performance checks and isolated hosted verification.

The current Stage 2 work can be committed and pushed as a development checkpoint. Production readiness requires the remaining functional and hosted-release gates.
