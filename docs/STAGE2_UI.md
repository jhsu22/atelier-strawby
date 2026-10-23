# Stage 2 — Visual design, collection browsing, and responsive UI

Subsequent UI cleanup (2026-10-21): the collection now opens with a compact heading and counts. Removed the welcome banner, decorative labels above headings, slogans, fabricated cover imprints, repeated artwork explanations and playful state messages. Drawers and the collection-record page use direct titles; collection facts, controls, notes, sample identification and necessary state guidance remain. Verification: `npm run validate > data/generated/clean-ui-validate.txt 2>&1` passed (48 unit / 21 integration tests, checking and build); `npm run test:e2e > data/generated/clean-ui-e2e.txt 2>&1` passed all 22 browser tests. A final `npm run build > data/generated/clean-ui-build.txt 2>&1` and built-runtime `npm run test:smoke > data/generated/clean-ui-foundation-smoke.txt 2>&1` passed. `node data/generated/clean-ui-browser.mjs > data/generated/clean-ui-browser.txt 2>&1` verified 15 screens at 320/768/1440 px with zero checked accessibility violations, page errors or overflow. Current captures: [mobile collection](../data/generated/clean-ui-320-grid.png), [desktop collection](../data/generated/clean-ui-1440-grid.png), [filters](../data/generated/clean-ui-320-filters.png) and [manga detail](../data/generated/clean-ui-320-manga.png). Earlier screenshots and copy below are historical.

The preceding [Stage 2 audit](STAGE2_AUDIT.md) records audit fixes and verification before the copy cleanup, including two real D1 tests, 22 browser tests on each runtime and 36 expanded accessibility scans. Verification below is the initial implementation record.

Implemented locally on 2026-10-21 under the user's revised Stage 2 scope. This scope supersedes the original metadata-first ordering. Stage 1's schema, migrations, CSV, normalization, imports and existing domain/database tests are preserved. The main shelf replaces the original landing page; `/foundation` retains its diagnostic functionality and the foundation smoke script resolves to that route.

## Implemented experience

| Area | Result |
| --- | --- |
| Design system | Specified paper/ink/strawberry/sage palette; shared light/dark surfaces, borders and contrast colors; locally served Newsreader, Inter and JetBrains Mono fonts with OFL notices. |
| Application shell | Responsive branding/header, persistent theme preference, All Media/Manga/CD switcher, desktop navigation and five-action mobile bottom navigation with safe-area spacing. |
| Real collection | Private server-rendered D1 reads: 177 manga copies, 38 canonical series and four clearly labeled sample CDs. A read-only refresh endpoint uses the same service. No generated collection JSON is imported into the runtime. |
| Cover grid | 2 columns at 360/390 px, 3 at 540 px, 6 at 1280/1440 px and 7 at 1600 px; real titles/credits, counts/languages, restrained hover movement and designed typographic book/CD fallbacks. |
| Virtual shelf | One spine per owned record, including duplicates; 177 manga + four sample CD spines without filters. Colors, widths, publisher/language/number labels and jewel-case edges distinguish physical media. Only intended spine/chip rows scroll horizontally. Filters restrict individual visible spines. |
| Search and filters | Search across titles/aliases, creators, publishers/labels and notes; language, publisher and memory filters match the same copy. Title/recent sorting, result counts, no-results reset and URL state survive refresh/back/forward. Search is substring-based; no fuzzy-search claim. |
| Manga detail | Native modal dialog becomes a bottom sheet on mobile and side panel on desktop; real creators, publishers, languages, edition titles, dates, notes, tags and individually retained copies. |
| Gap detection | Toggle compares distinct printed volume numbers within each edition run/language. Actual 86 reports 5–6. Duplicates do not create gaps; uncertain omnibus/nonnumeric numbering produces an explanation. No future volumes are inferred. |
| CD detail | Operable CSS jewel-case lid/disc, known titles/artists, explicit unresolved format/label/catalog/year, missing-tracklist presentation and sample acquisition notes. Ordered persisted tracklists have a rendering path; no tracklists were fabricated. |
| States and accessibility | Real refresh skeleton, retryable refresh error retaining current data, empty collection/no-results/missing-detail states, styled D1-unavailable response, keyboard Tab containment, Escape, focus restoration, backdrop close, reduced motion and touch-sized controls. |
| Navigation boundaries | Stats shows real current aggregates. Add and Haul Timeline open explicit upcoming-feature panels; no save or timeline behavior is fabricated. |

## Verification

Runtime: Node 26.11.1, npm 12.2.1, Chromium 155.0.8059.84 on Linux. Browser tooling: Playwright 1.64.1 and axe 4.14.0, pinned as development dependencies. [Playwright configuration](https://playwright.dev/docs/test-configuration) and [accessibility guidance](https://playwright.dev/docs/accessibility-testing) informed the browser setup.

| Command | Result |
| --- | --- |
| `npm install --save-dev --save-exact @playwright/test@1.64.1 @axe-core/playwright@4.14.0 --cache /tmp/atelier-strawby-npm-cache --fetch-retries=0 --fetch-timeout=20000` | PASS; existing application dependency pins retained. |
| `npm run validate > data/generated/stage2-validate.txt 2>&1` | PASS: Astro/TypeScript with zero errors/warnings (one pre-existing async hint), 48 unit + 20 integration tests, and production build. |
| `npm run test:unit > data/generated/stage2-unit.txt 2>&1` | PASS: 48 tests. |
| `npm run test:integration > data/generated/stage2-integration.txt 2>&1` | PASS: 20 tests. |
| `npm run test:schema > data/generated/stage2-schema.txt 2>&1` | PASS: unchanged 27-table schema/snapshot/migration parity. |
| `npm run test:d1 > data/generated/stage2-d1.txt 2>&1` | PASS: both preserved real workerd D1 tests; no skips. |
| `npm run verify:seed > data/generated/stage2-persisted.txt 2>&1` | PASS: original counts/distributions/dates/notes, FK/subtype integrity, duplicate ownership and excluded CD samples. |
| `npm run dev -- --port 4321 > data/generated/stage2-dev.txt 2>&1` | PASS: actual D1-backed Astro shelf. |
| `npm run test:e2e > data/generated/stage2-e2e.txt 2>&1`; final rerun with `STRAWBY_TEST_URL=http://127.0.0.1:4321 npm run test:e2e > data/generated/stage2-e2e.txt 2>&1` | PASS: 18 browser tests across desktop/mobile Chromium. |
| `npm run test:smoke -- --url http://127.0.0.1:4321 > data/generated/stage2-foundation-dev-smoke.txt 2>&1` | PASS: preserved foundation diagnostic, CSS, no-store headers and nonlocal Host rejection. |
| `npm run preview:pages -- --port 8788 --inspector-port 9230 > data/generated/stage2-pages-runtime.txt 2>&1` | PASS: built Pages worker with the real seeded local D1 store. An initial default-inspector startup collided with another Wrangler process; selecting 9230 resolved the environment conflict. |
| `STRAWBY_TEST_URL=http://127.0.0.1:8788 npm run test:e2e > data/generated/stage2-e2e-pages.txt 2>&1` | PASS: all 18 browser tests against the compiled Pages worker. |
| `npm run test:smoke > data/generated/stage2-foundation-pages-smoke.txt 2>&1` | PASS: compiled foundation regression check. |
| `npm run preview:pages -- --port 8789 --persist-to data/generated/stage2-runtime-state > data/generated/stage2-state-runtime.txt 2>&1` | PASS: isolated actual D1 runtime. Node HTTP assertions verified styled root 503/private JSON 503 before migration. |
| `npm run db:migrate:local -- --persist-to data/generated/stage2-runtime-state > data/generated/stage2-empty-migrate.txt 2>&1` | PASS: fresh baseline. Browser/HTTP assertions then verified an empty 200 shelf, zero records and setup guidance. |
| `sha256sum initial_collection.csv` | Unchanged: `8e7b935ee024654b715c4e88ac406013105961ef3282aec7e0f88ebb35004a0a`. |
| `git diff --exit-code -- src/server/db/schema drizzle scripts/seed-from-csv.ts scripts/lib/normalize.ts src/domain/normalization tests/unit/normalization.test.ts tests/integration/database.test.ts tests/d1/local-d1.test.ts` | PASS: no changes to those foundation files. |
| `rg -n 'node:(fs\|sqlite)\|seed-from-csv\|scripts/lib/normalize\|initial_collection\.csv\|normalized-collection\.json\|first b&n\|from sammy' dist` | PASS: exit 1/no matches; no private source, ingestion modules or collection-note text in static build assets. |
| `npm audit --json > data/generated/stage2-npm-audit.json` | Exit 1: 11 existing findings, 6 moderate/4 high/1 critical. No dependency-major/platform migration was made. |

The browser suite covers seeded totals, media/view switching, grid density and overflow at six widths, search/filter reset, URL persistence/history, multilingual and duplicate-copy detail, gap toggling, individual and filtered spines, CD case interaction, focus trapping/restoration, navigation, skeleton/error/retry, theme persistence, reduced motion and missing/empty states. Axe scans report **zero violations** for the covered WCAG A/AA rules on the light shelf, dark shelf and manga drawer at both viewport profiles.

Initial browser verification found Tab focus escaping a modal, one low-contrast muted badge and a switch decoration intercepting direct checkbox clicks. All were fixed before the passing runs. Test selectors were corrected to use the actual accessible combobox role. A mistaken test assumption of two total copies for The Guy She Was Interested in… was corrected to the actual three copies: volumes 1, 1 and 2. The collection was not modified to satisfy that test.

Visual review used actual screenshots from the compiled worker:

- [Desktop shelf](../data/generated/stage2-final-desktop.png)
- [Mobile shelf](../data/generated/stage2-final-mobile.png)
- [Mobile manga drawer](../data/generated/stage2-final-mobile-drawer.png)
- [Individual spines](../data/generated/stage2-final-mobile-spines.png)
- [CD jewel-case detail](../data/generated/stage2-final-cd.png)
- [Dark theme](../data/generated/stage2-final-dark.png)
- [Real empty database](../data/generated/stage2-empty-mobile.png)

## Remaining boundaries

The requested Stage 2 local interface is ready for review. Add/edit, complete Haul Timeline, remote artwork/metadata, verified CD release fields/tracklists, complete mutations and import/export remain intentionally unavailable. The four sample CDs retain Stage 1's honest unresolved metadata.

Browser evidence is Chromium with desktop and mobile emulation. The subsequent audit verifies emulated touch dismissal and body scrolling. Safari, Firefox, physical devices, physical touch behavior, screen-reader use and hosted authentication/deployment were not verified. Automated axe checks do not establish complete accessibility conformance. The pre-existing dependency audit findings and hosted-access boundary remain unchanged; this is local functional readiness.

No remote artwork API, production data write, schema migration change or deployment was performed. Verification artifacts remain under ignored `data/generated/`; personal collection data was not copied into public assets.
