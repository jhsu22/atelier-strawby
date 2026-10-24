# Stage 5 — release engineering and final audit

**Assessment: locally verified release candidate; not production-ready for hosted sign-off. No deployment occurred.** The unresolved Astro/Pages dependency findings and missing hosted authentication, resource, recovery and performance verification are release blockers, not completed requirements.

The complete original specification and current project were audited in [REQUIREMENTS_MATRIX.md](REQUIREMENTS_MATRIX.md). The source includes all previous Stage 1–4 work and existing book/light-novel, Google Books and released-volume features; this stage did not introduce a new product area. The supplied CSV and migrations remain unchanged, and the owner's edited local data was preserved.

## Changes made in this stage

- Added pinned ESLint/TypeScript/Astro linting, a dedicated CSV regression command, a disposable Wrangler migration/journal check, deployment config guards and a complete release verification command.
- Fixed a backup growth defect: JSON export could outgrow the 900 KB import limit and single-row preview storage. JSON now accepts up to 8 MiB, previews use bounded UTF-8-safe chunks, and table inserts use bounded parameters within one atomic restore. Small/legacy previews and resumable CSV discovery remain compatible. CSV retains its existing 900 KB/1,000-record limit.
- Replaced repeated relationship scans in library loading and physical-copy validation with indexes/maps. Added real D1 and SQLite tests restoring **2,124 copies** from a multi-megabyte backup, checking every table and missing-chunk failure behavior.
- Added a React render error boundary with recovery navigation. Existing D1, refresh, form, metadata and image failure states remain.
- Added browser tests for actual JSON download → deleted-copy restore → reload, malformed/cross-origin requests, and **5,000 copies across 1,000 titles**. Retained all original browse, details, gaps, timeline, CRUD, CSV, accessibility and persistence tests.
- Patched compatible transitive Undici/ws advisories. Audit findings fell from 13 to 11; the remaining framework/toolchain findings are documented without claiming remediation.
- Added a separate hosted config template, guarded Pages upload/staging commands, isolated preview/production binding requirements, deployment/rollback runbook, user guide, directory map and source ZIP packaging with SHA-256 manifest.

## Verification environment and results

Linux, Node **26.11.1**, npm **12.2.1**, Astro **5.18.2**, Cloudflare adapter **12.6.13**, Wrangler **4.151.3**, Playwright **1.64.1**, system Chromium and axe **4.14.0**. Pinned versions and transitive patches are in `package-lock.json`.

| Check | Final result |
| --- | --- |
| Dependency installation | `npm ci` passed; pinned ESLint installation and patched dependency resolution passed. npm reports existing upstream deprecations/lifecycle-script notices. |
| Lint | `npm run lint`: no errors or warnings. |
| TypeScript/Astro | `npm run check`: 0 errors, 0 warnings; one pre-existing suggestion to use async in `readCollectionSummary`. |
| Unit | `npm run test:unit`: 69 passed, no skipped tests. Includes deployment-config rejection checks. |
| CSV regression | `npm run test:csv`: 35 passed, including original source hash and all correction/cascade/grouping rules. These overlap unit coverage. |
| Integration | `npm run test:integration`: 43 passed, no skips. Disposable SQLite, provider fixtures, CLI, imports/backups and independent data reconciliation. |
| D1/R2 | `npm run test:d1`: 8 passed, no skips. Real local workerd bindings, persistence after reopening, transactional restore, artwork cache and scale scenario. |
| Schema | `npm run test:schema`: 27-table parity after both reviewed migrations, including columns, keys, indexes and CHECK constraints. |
| Migration runner | `npm run test:migrations`: fresh local Wrangler D1 applies both SQL files; second application is a no-op; journal and foreign keys checked. D1 does not support SQLite `PRAGMA integrity_check`; that attempted statement was removed from the D1 check rather than reported as passing. |
| Hosted configuration staging | `deploy:prepare` exercised with synthetic IDs only in the extracted copy; local Pages loaded the staged DB/bucket bindings and returned the expected empty library after migration. No hosted resources were contacted. |
| Production build | `npm run build`: Pages worker/assets generated and exercised in local Pages runtime. |
| Browser | **All 54 desktop/mobile scenarios verified.** Final full run passed 52 and exposed two cancelled-transition errors in the release-panel test waiter; after fixing the waiter, all four `releases.spec.ts` scenarios passed (17.8 s), including both affected cases. No skips. Earlier six new production scenarios also passed together. Tests use real disposable D1/R2 and deterministic provider fixtures. |
| Runtime smoke | PASS at `http://127.0.0.1:4398`: built-worker D1 counts, React SSR, stylesheet/private headers and nonlocal Host denial, using the extracted archive. |
| Dependency audit | **11 findings: 4 moderate, 6 high, 1 critical**. This check deliberately does not pass a security release gate. |
| Archive | 206 source files with verified SHA-256 manifest; clean extraction, `npm ci`, production build, local migrations/seeds and `verify:seed` passed without owner credentials. Configured-secret scan passed. |

Initial verification exposed test-fixture mistakes in the new browser checks (select label matching and Playwright JSON-string serialization), an accessibility scan sampling a theme transition, Wrangler staged preview resolving its parent package’s local configuration, a missing preview-manifest field needed for CSV resume, and an existing integration test's dependence on small-preview storage. The fixes preserve old/small previews and include the fields needed for resumability. The theme audit now waits for active transitions and the staging directory has its own private package boundary. Final targeted results supersede those initial failures; no failing test was marked skipped or removed. The last all-suite command is not represented as a single uninterrupted green run: the two harness failures were corrected and rerun as described above.

## Performance observations

A **2,654,615-byte** backup containing **2,124 physical manga copies** was restored and compared table-for-table in SQLite and real local D1. A representative standalone D1 run measured approximately **613 ms** for preview plus restore/integrity scenario, **85 ms** for library loading and **10 ms** for multilingual search. These are local wall-clock observations, not Cloudflare CPU measurements or service-level promises. Test logs print each run's timings.

The browser scale test injects a valid library response containing **1,000 series / 5,000 copies**, renders all cards, searches the final series and opens its five-copy details without horizontal document overflow. The main island is approximately 40.56 kB gzip, React client 59.18 kB gzip and the small index chunk 3.06 kB gzip, excluding CSS/fonts and serialized library data. Its render/payload measurements are attached to the Playwright JSON report. This isolates client behavior; it is **not** a 5,000-copy hosted database/network test. Whole-library delivery and a nonvirtualized DOM remain scaling limits.

## Reproduce

```bash
npm ci
npm run release:verify
npm run test:csv
npm run release:zip
```

`release:verify` runs lint, type validation, unit/integration tests, schema check, build, D1/R2, Wrangler migration checks and Playwright. Browser tests build and seed their own temporary store. Set `STRAWBY_TEST_PORT=4399` if your app occupies 4321. The source archive’s local D1 setup also passes `verify:seed`; `verify:insights` reconciles the existing owner-edited local collection without resetting it. `db:generate` reports no schema changes. Mobile light timeline and desktop dark analytics screenshots were visually inspected.

Test artifacts stay under ignored `data/generated/`; logs for this audit are `/tmp/strawby-*.log`. The final portable summary is this report; generated traces may contain test/collection data and are not included in the source ZIP.

## Required manual work and limitations

1. Resolve or formally remediate the remaining dependency advisories on a supported deployment stack. Astro 5's latest available patch remains affected; do not silently force a platform migration or downgrade Wrangler. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md).
2. Supply a Cloudflare account, create separate D1/R2 resources and a Pages project, configure exact origins, owner Access policies and runtime secrets, then deploy preview and production. No resource IDs were invented as working bindings.
3. Run hosted acceptance and recovery drills: login/denial, direct aliases, mutations, R2/provider calls, persistence, JSON/SQL and object backups, rollback and quota/performance limits. The runbook is implemented; these operations are unverified.
4. Live provider network/quotas were not re-probed during Stage 5; current provider tests use fixtures, and historical live evidence is labeled in earlier-stage reports. Verify Safari/Firefox, physical phones, screen readers and the minimum Node 22 runtime. Chromium/axe testing is useful but not equivalent to these checks.
5. Provider metadata/artwork is incomplete by nature and must be reviewed. Sample CD release facts remain unknown until supplied. The bulk cover CLI only targets local state; no remote enrichment scheduler, cache-retention job, full-bucket backup automation or general API abuse limiter is installed.
6. The exact original palette/serif-heading/display-name treatment differs from the retained Stage 2 Atelier Strawby design. Shelf cards choose the first available owned cover rather than guaranteeing volume 1/latest. These are explicit partial requirements in the matrix, not silently marked complete. Reconcile them in a focused design pass if literal original-spec fidelity is desired.
7. JSON UI restore is bounded to 8 MiB and 20,000 rows per table; larger snapshots use D1 SQL tooling. R2 image bytes are separate. For substantially larger use, add measured server pagination/search, list virtualization and hosted performance budgets.

Deliverables: [directory map](DIRECTORY_STRUCTURE.md), [local/deployment/env/migration/seed/rollback instructions](DEPLOYMENT.md), [user guide](USER_GUIDE.md), [requirements matrix](REQUIREMENTS_MATRIX.md), [security review](SECURITY_REVIEW.md), and `releases/atelier-strawby-stage5.zip` with adjacent checksum. The source ZIP is a complete rebuildable project, not a backup of the owner's current live database.
