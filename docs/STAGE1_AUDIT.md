# Stage 1 implementation audit

Audited 2026-10-21, America/Los_Angeles, with Node 26.11.1 and npm 12.2.1. Scope: the eight Stage 1 acceptance criteria in [ROADMAP.md](ROADMAP.md). Stages 2–5 were not started.

**Ready for Stage 1 local functional approval.** All required local checks pass after the fixes below. Dependency security findings remain unresolved; hosted/security-release approval is not supported by these results.

## Findings and fixes

| Finding | Resolution |
| --- | --- |
| `--database public/private.sqlite` was accepted, allowing private verification data to enter static build assets. The output-directory guard also checked only lexical paths. | `scripts/lib/cli.ts` now checks artifact and database destinations against both lexical and physical `public/` and `dist/` paths, including symlinks and missing descendants. In-memory/private destinations remain usable. Three regression tests pass. |
| HTTP smoke passed when all stylesheet links were absent, because its CSS loop ran zero times. | `scripts/smoke-stage1.ts` requires a linked stylesheet or inline layout CSS. A synthetic unstyled response with correct counts is rejected by an integration regression test. Actual dev inline CSS and built CSS both pass. |
| Changed-source refusal was covered through the import library, but the CLI's reconciliation artifact and process outcome were untested. | A new integration test runs migration/import/repeat/changed-source CLI processes against a disposable database, checks the report and nonzero conflict exit, and verifies 177 retained copies, unchanged owner edits and revision 1. |
| Empty/unavailable D1 UI and nonlocal Host handling needed fresh runtime evidence. | Actual built Pages requests against a separate D1 store verify an unmigrated 503/alert and a migrated empty 200/setup message. Seeded smoke now sends the nonlocal Host through `node:http`; Pages rejects it with 503 and Astro/Vite with 403. |

Implementation changes: `scripts/lib/cli.ts`, `scripts/smoke-stage1.ts`. Added tests: `tests/unit/cli.test.ts`, `tests/integration/cli.test.ts`, `tests/integration/smoke.test.ts`. Updated README and stage/testing documents. No schema, source CSV, dependency version, or product feature change was needed.

## Acceptance comparison

| Criterion | Audit result |
| --- | --- |
| 1. Install, strict checking, Pages build, real D1, isolated parser | PASS: clean `npm ci`, zero check errors/warnings, build, real workerd tests and HTTP responses; runtime graph scan has no private source/Node ingestion matches. |
| 2. Real parser, 177 records, 38 series, unchanged source | PASS: source hash and deterministic JSON artifacts unchanged. |
| 3. Corrections, multilingual editions, duplicate copies and cascade edges | PASS: unit/domain assertions and persisted duplicate/subtype checks. |
| 4. Date/language/note audit totals | PASS: 172 dated/5 undated, years 21/96/26/29, EN/JP/KR 167/9/1, 97 notes; persisted D1 and SQLite agree. |
| 5. Repeat import, preserved edits, changed-source reconciliation | PASS: SQLite, actual D1 and CLI process tests; existing development seed returns `already-imported` twice. |
| 6. D1 relational/subtype integrity and normalized schema | PASS: actual D1 rollback/FK/subtype/interruption tests; 27-table schema parity; fresh and repeat migration checks. |
| 7. Four honest sample CDs, excluded from personal counts | PASS: four idempotent samples, no invented dates/tracks/catalog metadata, zero personal CDs. |
| 8. Runnable documentation and configuration boundaries | PASS: local, offline and Pages instructions exercised; unprovisioned hosted resources and remaining security findings documented. |

## Exact verification commands and results

Commands ran from the project root. Some were repeated while checking fixes; the listed audit logs contain the final results. Server commands ran in separate processes and all were stopped afterward. Exit codes are 0 unless stated otherwise.

| Exact command | Result / evidence under `data/generated/` |
| --- | --- |
| `node --version` and `npm --version` | v26.11.1 / 12.2.1 |
| `npm ci --cache /tmp/atelier-strawby-npm-cache --fetch-retries=0 --fetch-timeout=20000 > data/generated/audit-npm-ci.txt 2>&1` | PASS: 496 installed packages; lifecycle-script/deprecation warnings recorded. |
| `npm ls --depth=0 > data/generated/audit-npm-ls.txt 2>&1` | PASS: all direct pins resolve. |
| `npm run db:types > data/generated/audit-binding-types.txt 2>&1` | PASS: binding declarations generated. |
| `npm run db:generate > data/generated/audit-migration-generation.txt 2>&1` | PASS: no schema changes or new migrations. |
| `npm run validate > data/generated/audit-validate.txt 2>&1` | PASS: Astro/TypeScript, 38 unit + 17 integration tests, Pages production build. No failed/skipped tests. One existing async-function hint. |
| `npm run test:unit > data/generated/audit-unit.txt 2>&1` | PASS: 38 tests. |
| `npm run check > data/generated/audit-check.txt 2>&1` | PASS: 48 files, zero errors/warnings, one hint. |
| `npm run test:integration > data/generated/audit-integration.txt 2>&1` | PASS: 17 tests, including CLI and smoke regressions. |
| `npm run test:schema > data/generated/audit-schema.txt 2>&1` | PASS: 27-table schema/snapshot/migration parity. |
| `npm run test:d1 > data/generated/audit-d1.txt 2>&1` | PASS: 2 actual workerd D1 tests, no skips. |
| `npm run db:migrate:local > data/generated/audit-migrate.txt 2>&1` | PASS: existing development database already current. |
| `npm run db:migrate:local > data/generated/audit-migrate-repeat.txt 2>&1` | PASS: no pending migrations on repeat. |
| `npm run seed:local > data/generated/audit-seed.txt 2>&1` | PASS: `already-imported`, 177 copies. Fresh import also verified by D1 tests. |
| `npm run seed:local > data/generated/audit-seed-repeat.txt 2>&1` | PASS: same no-op result. |
| `npm run seed:sample-cds > data/generated/audit-samples.txt 2>&1` | PASS: four existing samples retained. |
| `npm run verify:seed > data/generated/audit-persisted.txt 2>&1` | PASS: complete persisted D1 invariants. |
| `npm run preview:pages -- --port 8788 > data/generated/audit-pages-runtime.txt 2>&1` | PASS: built worker and local D1. |
| `npm run test:smoke > data/generated/audit-pages-smoke.txt 2>&1` | PASS: seeded data, React SSR, privacy headers, one linked stylesheet and nonlocal Host rejection. |
| `npm run dev -- --port 4321 > data/generated/audit-astro-runtime.txt 2>&1` | PASS: actual Astro runtime. |
| `npm run test:smoke -- --url http://127.0.0.1:4321 > data/generated/audit-astro-smoke.txt 2>&1` | PASS: seeded data, inline CSS and nonlocal Host rejection. |
| `npm run preview:pages -- --port 8789 --persist-to data/generated/audit-runtime-state > data/generated/audit-pages-failure-runtime.txt 2>&1` | PASS: separate disposable D1 runtime. |
| `npm run db:migrate:local -- --persist-to data/generated/audit-runtime-state > data/generated/audit-runtime-migrate.txt 2>&1` | PASS: fresh baseline, 72 SQL commands. |
| `npm run db:migrate:sqlite > data/generated/audit-sqlite-migrate.txt 2>&1` | PASS. |
| `npm run seed:sqlite > data/generated/audit-sqlite-seed.txt 2>&1` | PASS: repeat import. |
| `npm run seed:sample-cds -- --target sqlite > data/generated/audit-sqlite-samples.txt 2>&1` | PASS: four samples. |
| `npm run verify:seed -- --target sqlite > data/generated/audit-sqlite-persisted.txt 2>&1` | PASS: persisted SQLite invariants. |
| `npm run preview:offline > data/generated/audit-offline-render.txt 2>&1` | PASS: database-backed HTML. |
| `npm run dev:offline > data/generated/audit-offline-runtime.txt 2>&1` | PASS: local diagnostic server. |
| `curl --silent --show-error --fail --max-time 20 --output data/generated/audit-offline-served.html http://127.0.0.1:4322/` | PASS: returned HTML independently checked for 177 manga and four excluded samples. |
| `sha256sum initial_collection.csv` | PASS: `8e7b935ee024654b715c4e88ac406013105961ef3282aec7e0f88ebb35004a0a`. |
| `sha256sum data/generated/normalized-collection.json data/generated/validation-summary.json data/generated/import-statements.json > data/generated/audit-artifact-digests.txt` followed by `sha256sum --check data/generated/audit-artifact-digests.txt` | PASS: all three artifacts unchanged across reimports. |
| `rg -n 'node:(fs\|sqlite)\|seed-from-csv\|scripts/lib/normalize\|initial_collection\.csv\|normalized-collection\.json\|first b&n\|from sammy' dist` | PASS: exit 1 means no matches. |
| `npm audit --json > data/generated/audit-dependencies.json` | NOT CLEAN, exit 1: 11 findings, 6 moderate/4 high/1 critical. |

Additional exact runtime probes (run before/after migration respectively):

```bash
node --input-type=module -e 'import assert from "node:assert/strict"; const response = await fetch("http://127.0.0.1:8789/"); const html = await response.text(); assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(html, /role="alert"/); assert.match(html, /collection database is unavailable/); assert.ok(!html.includes("Physical manga copies")); console.log("Unmigrated D1: graceful 503 with private headers, alert, and no collection data.");' > data/generated/audit-unavailable-state.txt 2>&1
node --input-type=module -e 'import assert from "node:assert/strict"; const response = await fetch("http://127.0.0.1:8789/"); const html = await response.text(); const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(text, /Physical manga copies 0/); assert.match(text, /Unique series 0/); assert.match(text, /No collection has been imported yet/); assert.match(text, /0 personal CDs.*0 demonstration CDs/); console.log("Migrated empty D1: 200, zero counts, setup guidance, and private headers.");' > data/generated/audit-empty-state.txt 2>&1
curl --silent --show-error --max-time 20 -H 'Host: atelier-strawby.example' --dump-header data/generated/audit-pages-host-headers.txt --output data/generated/audit-pages-host.html http://127.0.0.1:8788/
curl --silent --show-error --max-time 20 -H 'Host: atelier-strawby.example' --dump-header data/generated/audit-astro-host-headers.txt --output data/generated/audit-astro-host.html http://127.0.0.1:4321/
```

The curls returned Pages 503/private-no-store and Astro/Vite 403 with no collection data. An exploratory `fetch` probe using an overridden Host failed its expected-status assertion because Node did not transmit that header; it was replaced with the actual `node:http` probe in the passing smoke command. Its failed output remains in `audit-host-fetch-invalid.txt`. The unsafe database option probe initially exited 0 and now exits 1; no private database was created under `public/` during the audit.

## Remaining limitations

- Dependency audit findings, including one critical finding, remain. The report suggests major Astro/adapter upgrades; changing the required Astro 5/Pages platform was outside this stage. Existing passthrough-image/local-access restrictions do not constitute a clean security audit.
- Hosted bindings, Access JWT authentication, external metadata/artwork, full browser/device coverage and deployment remain unverified later-stage work. CD release metadata is explicitly unresolved. The documented language, acquisition-date, regional-publisher and omnibus uncertainties remain preserved.
- Only Node 26.11.1 was executed in this audit; the declared Node 22.18 minimum was not independently exercised.
- The workspace is not a Git repository (`git status --short && git log -6 --oneline` exited 128). Review used current requirements, source inspection and saved pre-fix file copies; a historical Git diff was unavailable.
