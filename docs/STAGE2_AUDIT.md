# Stage 2 audit

Audited 2026-10-21 against the user's revised visual-design and browsing requirements, including equal-height manga spines. **Ready for local Stage 2 approval.** Stage 3 was not started. Hosted release still has the separate security/access requirements described below.

## Acceptance comparison

| Requirement | Verified result |
| --- | --- |
| Preserve Stage 1 | Schema, migrations, importer, normalization, source CSV and original test files unchanged. Schema parity, both real D1 tests, persisted seed checks and `/foundation` smoke pass. |
| Design system and shell | Shared specified colors, local serif/sans/mono fonts, light/dark preference, media switcher, desktop navigation and five mobile/tablet navigation actions. |
| Cover grid | Real 38 manga series plus four labeled CD samples; responsive 2–3 phone / 5–7 desktop columns, language/count labels and designed physical-media artwork placeholders. No document overflow at 320–1600 px tested widths. |
| Virtual shelf | All 177 manga copies, including duplicates, have 235 px spines. Width/color/publisher/language labels vary; four sample CD spines remain distinct. Rows scroll horizontally and spines open details. |
| Manga details | Bottom sheet/desktop panel, real metadata and copy dates/notes/editions/languages; language filtering; optional edition-aware internal gaps; duplicate copies retained; uncertain numbering explained. |
| CD details | Operable jewel case, sample notices, known/unresolved metadata, acquisition notes and tracklist state. Populated release fields and ordered multi-disc tracks verified with explicitly synthetic test data, without editing the collection. |
| Polish and states | Keyboard containment/return, Escape/backdrop dismissal, emulated touch swipe dismissal and body scrolling, reduced motion, refresh skeleton/retry, no results, missing detail, actual empty D1 and unavailable D1. |

Stats uses real aggregates. Add and Haul Timeline have working navigation to explicit coming-soon panels; their editing/timeline content remains later-stage work. Artwork is intentionally typographic and CD release facts remain unresolved until verified. These boundaries do not block the requested Stage 2 browsing interface.

## Verified issues fixed

| Finding | Fix and evidence |
| --- | --- |
| No navigation between 651 and 900 px | Extended bottom navigation and footer clearance through the tablet breakpoint; browser coverage includes 651, 768, 900 and 901 px. |
| 2 px horizontal overflow at 320 px | Reduced the narrow-screen media-switcher gap; viewport sweep now fits. |
| Sheet swipe canceled by browser scrolling | Allowed horizontal panning on the sheet header so vertical pointer gestures reach dismissal; CDP touch tests verify dismissal, focus return and separate body scrolling. |
| Open CD lid clipped on small phones | Limited the mobile opening angle; a regression test first reproduced an 82 px left-edge overrun at 320 px, then passed after waiting for the complete animation. |
| Publisher labels failed contrast on some spines | Removed text opacity. The expanded scan initially flagged only spine screens (example ratio 4.25:1); final scans and the permanent spine accessibility test pass. |
| Unknown CD artist displayed as “Various artists” | Replaced the invented credit with “Artist unresolved” in artwork/cards. |
| Populated CD fields/tracklist had only an untested rendering path | Added an in-memory persistence test for ordered multi-disc tracks and a browser test using a synthetic refresh response. No fabricated release facts were seeded. |

## Commands and results

Environment: Node 26.11.1, npm 12.2.1, Linux Chromium 155.0.8059.84, Playwright 1.64.1 and axe 4.14.0. Commands below ran from the repository root; evidence is under ignored `data/generated/`. Commands rerun after fixes retain their final output at the same path.

| Exact command | Result |
| --- | --- |
| `npm ci --cache /tmp/atelier-strawby-npm-cache --fetch-retries=0 --fetch-timeout=20000 > data/generated/stage2-audit-npm-ci.txt 2>&1` | PASS: clean locked install. |
| `npm run validate > data/generated/stage2-audit-validate.txt 2>&1` | PASS: Astro/TypeScript 0 errors, 0 warnings, one existing async hint; **48 unit + 21 integration tests**, no failures/skips; production build. |
| `npm run test:integration > data/generated/stage2-audit-integration.txt 2>&1` | PASS: 21, including populated multi-disc read-service coverage. |
| `npm run test:schema > data/generated/stage2-audit-schema.txt 2>&1` | PASS: 27-table schema/snapshot/migration parity. |
| `npm run test:d1 > data/generated/stage2-audit-d1.txt 2>&1` | PASS: **2 real workerd D1 tests**, no failures/skips. |
| `npm run verify:seed > data/generated/stage2-audit-persisted.txt 2>&1` | PASS: 177 personal manga, 38 series, 172 dated/5 undated, 97 notes, preserved languages/duplicates, four excluded sample CDs. |
| `npm run dev -- --port 4321 > data/generated/stage2-audit-dev-runtime.txt 2>&1` | PASS: seeded D1-backed development application, used for initial diagnostic probes. |
| `node data/generated/stage2-audit-probe.mjs > data/generated/stage2-audit-probe-after.txt 2>&1` | PASS after fixes: responsive navigation/overflow sweep and emulated touch dismissal. |
| `npm run test:e2e > data/generated/stage2-audit-e2e-dev.txt 2>&1` | PASS: **22 browser tests**, desktop/mobile Chromium; final run starts/stops its own Astro dev server. |
| `npm run preview:pages -- --port 8788 --inspector-port 9230 > data/generated/stage2-audit-pages-runtime.txt 2>&1` | PASS: compiled Pages worker with seeded local D1. |
| `STRAWBY_TEST_URL=http://127.0.0.1:8788 npm run test:e2e -- --grep 'CD drawer opens' > data/generated/stage2-audit-cd-clipping-before.txt 2>&1` | Reproduced clipping: desktop passed, mobile failed before the CSS fix. Final full suite passes. |
| `STRAWBY_TEST_URL=http://127.0.0.1:8788 npm run test:e2e > data/generated/stage2-audit-e2e-pages.txt 2>&1` | PASS: **22 browser tests** against the compiled worker; no failures/skips. |
| `node data/generated/stage2-audit-browser.mjs > data/generated/stage2-audit-browser.txt 2>&1` | PASS: **36 WCAG A/AA scans** across grid, spines, filters, stats, manga and open CD details; light/dark at 320/768/1440 px. Zero violations, page errors or tested overflow/clipping. All 177 manga spines measure 235 px. |
| `npm run test:smoke > data/generated/stage2-audit-foundation-smoke.txt 2>&1` | PASS: compiled foundation counts, SSR, sample exclusion, CSS, no-store headers and nonlocal Host rejection. |
| `npm run preview:pages -- --port 8789 --inspector-port 9231 --persist-to data/generated/stage2-audit-runtime-state > data/generated/stage2-audit-state-runtime.txt 2>&1` | PASS: separate disposable D1 state; seeded store untouched. |
| `node data/generated/stage2-audit-state.mjs unavailable > data/generated/stage2-audit-unavailable.txt 2>&1` | PASS: real missing-schema root/API 503, private/no-store, styled error, no 320 px overflow. |
| `npm run db:migrate:local -- --persist-to data/generated/stage2-audit-runtime-state > data/generated/stage2-audit-empty-migrate.txt 2>&1` | PASS: baseline applied only to disposable state. |
| `node data/generated/stage2-audit-state.mjs empty > data/generated/stage2-audit-empty.txt 2>&1` | PASS: actual empty root/API 200, private/no-store, zero entries and setup guidance. |
| `npm audit --json > data/generated/stage2-audit-dependencies.json` | **Exit 1: 11 existing findings — 6 moderate, 4 high, 1 critical.** |
| `sha256sum initial_collection.csv` | Unchanged: `8e7b935ee024654b715c4e88ac406013105961ef3282aec7e0f88ebb35004a0a`. |
| `git diff --exit-code -- src/server/db/schema drizzle scripts/seed-from-csv.ts scripts/lib/normalize.ts src/domain/normalization tests/unit/normalization.test.ts tests/integration/database.test.ts tests/d1/local-d1.test.ts` | PASS: Stage 1 sources and original tests preserved. |

The final build also passed this runtime-artifact scan (exit 1 with no matches is the expected success):

```bash
rg -n 'node:(fs|sqlite)|seed-from-csv|scripts/lib/normalize|initial_collection\.csv|normalized-collection\.json|first b&n|from sammy' dist
```

Visual inspection used actual browser captures, including [320 px shelf](../data/generated/stage2-audit-320-light-grid.png), [tablet shelf](../data/generated/stage2-audit-768-light-grid.png), [dark desktop spines](../data/generated/stage2-audit-1440-dark-spines.png), [mobile manga detail](../data/generated/stage2-audit-320-light-manga.png) and [open mobile CD](../data/generated/stage2-audit-320-light-cd.png). Temporary test data and screenshots stay ignored. Owned preview/dev servers were stopped after verification.

An initial probe ran before its local server was listening, and a standalone axe diagnostic initially used the wrong Playwright context API; both test-harness setup errors were corrected and are not counted as application failures or successful checks.

## Remaining limitations and approval

- **Not a Stage 2 blocker:** real artwork, verified CD release details, mutations/editing, import/export and timeline content remain intentionally deferred. The four CD entries are visibly samples; their unknown fields are not production metadata.
- **Unverified environments:** Safari, Firefox, physical devices/touch keyboards/safe areas, screen-reader use and Node 22 were not exercised. Chromium touch emulation and automated accessibility scans do not establish full device or accessibility conformance.
- **Before hosted release:** resolve/review the 11 inherited dependency advisories and implement/verify hosted authentication. The existing Astro 5/Pages adapter dependency boundary requires a separate platform/security decision; this UI audit did not migrate the stack or deploy anything. See [the existing dependency review](TESTING.md#dependency-security-review).

The requested local Stage 2 interface is functional and ready for approval. The deferred features and broader device checks do not require implementation before approving this stage; the security/access items remain a hosted-release gate.
