# Testing strategy and verification record

**Current status: Stage 5 local release QA is complete; hosted production sign-off is blocked.** See [STAGE5.md](STAGE5.md) for current results, [REQUIREMENTS_MATRIX.md](REQUIREMENTS_MATRIX.md) for scope, and [DEPLOYMENT.md](DEPLOYMENT.md) for operations. The sections below retain historical Stage 1–4 evidence; their counts/advisory totals are not the current release assessment.

Latest revalidation: [Stage 3 development assessment](DEVELOPMENT_STATUS.md). **57 unit + 32 integration + 5 actual D1 + 34 desktop/mobile browser tests pass**, plus checking/build, schema parity, persisted seed verification and built Pages smoke. No final suite failures/skips remain. The dependency audit still reports **13 findings: 6 moderate, 6 high, 1 critical**. Earlier Stage 1–2 results below are historical.

## Stage 3 verification

| Command/check | Actual result |
| --- | --- |
| `npm run validate` | PASS: Astro/TypeScript 0 errors, 0 warnings, 1 existing hint; 54 unit and 30 integration tests, including cover-utility and Open Library edition/publisher-matching tests; Pages production build. |
| `npm run test:d1` | PASS: 4 real workerd tests, including CRUD, duplicate identity, stale/shared-series edits, staged imports, exact JSON restore and reopening persistent state. The cover-utility scenario runs against real D1 plus real local R2 and is verified after a runtime restart. |
| `npm run test:e2e` | PASS: 32 desktop/mobile Chromium tests in 1.0 minute on disposable seeded D1/R2. Includes loaded artwork filling the cover footprint without the placeholder, and failed artwork (including failures before hydration) keeping the typographic cover. Includes a browser stale-edit test: another session saves first, the editor shows the 409 conflict, keeps the draft and leaves the other session's edit intact. Real add/edit/delete and reload for both manga and CDs, metadata failure with manual entry, tracklist corrections, filter combinations, import previews, duplicate prevention, exports/restoration and origin enforcement. |
| `npm run test:e2e -- --grep 'import preview'` | PASS: 2 desktop/mobile tests in 10.6 seconds after preserving empty catalog numbers in multi-label CSV. |
| `npm run test:schema` | PASS: schema/migration/snapshot parity. No Stage 3 schema change. |
| `npm run verify:seed` | PASS: original persisted baseline remains 177 manga / 38 series / 4 sample CDs with original distributions and provenance. |
| `npm run test:smoke -- --url http://127.0.0.1:8791` | PASS against compiled Pages worker: D1 counts, SSR, private headers, sample exclusion, CSS and nonlocal Host rejection. |
| Editor visual probe | PASS: manga/CD dialog and document fit 320/768/1440 px. Narrow light and desktop dark images inspected. Existing shelf responsive checks also pass. |
| Real metadata/R2 probe | PASS: real Japanese MangaDex volume and Japanese MusicBrainz limited CD/Blu-ray release cached in local D1/R2, then verified after closing/reopening the runtime. Exact release and explicit representative fallback were both exercised. |
| Cover utility live run (Open Library fallback) | PASS on a copy of the dev state: 92 of 176 volume editions covered, 56 Open Library covers cached in R2, light-novel editions rejected by publisher, samples visually confirmed. |
| Cover utility live run (MangaDex only) | PASS on a disposable copy of seeded local D1/R2: 35 of 176 volume editions matched and cached, 129 unmatched with reasons, 12 non-standard editions skipped, 0 failed, 4 sample CDs need selection. Limited reruns resumed without repeated requests; seven cached covers visually confirmed. The development collection was not modified. |
| `npm audit --json` | Exit 1: 13 existing affected-package findings; no production-readiness claim. |

Light novels/books: a shared SQLite + real D1 scenario covers whole-edition reclassification, clearing automatic covers while keeping owner covers, stale-version rejection, book entries beside a same-titled manga series, the Books tab, the type filter, the author shelf, foundation counts, the CSV Medium column (including invalid values) and restoring a pre-medium backup. The real D1 test also confirms D1 accepts the `ADD COLUMN … CHECK` migration, and `wrangler d1 migrations apply --local` was rehearsed on a copy before the dev collection was migrated. A browser test adds a book through the form with a mocked Open Library candidate, then checks the Books tab, the drawer and the author shelf, plus the LN badge and filter and an axe scan. The mobile overflow assertions now compare against the visual viewport. The previous `innerWidth` comparison missed a 10 px overflow from four media tabs, because mobile layout widens `innerWidth`.

Set `STRAWBY_TEST_PORT` to run the disposable browser server on another port while `npm run dev` uses 4321. The default Playwright web server builds the application, creates and seeds temporary D1/R2, and destroys that test state after shutdown. It does not reuse a development server. Set `STRAWBY_TEST_URL` only for an explicitly disposable seeded server: management tests perform real persistent mutations. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if the system Chromium path is unavailable.

Cover-utility tests use a fake MangaDex and R2 to cover: exact volume/language matches; ambiguous titles; missing covers; skipped collector's editions; preserved owner artwork; copy-version increments; R2 caching; dry runs; reruns with zero provider requests; stable asset identity after an owner re-save; Retry-After deferral and resume; and series limits that move forward.

Failure coverage injects provider timeout, malformed JSON, 429/503 Retry-After, unavailable exact covers and fallback responses. It exercises local manual saving while external lookup fails. Provider success/missing/failure caches and R2 reuse are asserted. JWT tests cover signature, issuer, audience, expiry, owner email, origin and CSRF restrictions. Input tests cover calendar dates, URLs, body limits, disc/track relationships and duplicate positions. Real D1 and SQLite share service scenarios rather than substituting one for the other.

Live probes are supplementary and are not required by `npm test`. No guessed provider metadata was applied to the user's baseline collection. The iTunes fallback is explicitly digital and does not import promotional artwork. Documentation: [STAGE3.md](STAGE3.md).

Logs: `/tmp/strawby-stage3-validate.log`, `-d1.log`, `-e2e.log`, `-e2e-transfer.log`, `-schema.log`, `-seed.log`, `-smoke.log`, and `-audit.json`. Visual/live evidence is under ignored `data/generated/`. A transient smoke attempt after the disposable browser server had already exited was retried successfully against the running Pages worker. Initial E2E selector mismatches were corrected; final full and focused runs are recorded above.

Limits: no hosted Cloudflare deployment; no Safari/Firefox, physical-device, screen-reader or hosted performance sign-off. Authentication is locally tested but still requires a real owner Access policy and hosted verification. Dependency advisories and plan-specific D1 limits remain release gates.

## Stage 2 visual and browsing verification

The user's revised Stage 2 scope supersedes the original stage ordering. Current results: **48 unit + 21 integration tests, two actual D1 tests, full checking/build and 22 browser tests on each of the dev and built Pages runtimes pass**. No failed/skipped cases remain in final runs. The expanded 36 axe scans have zero violations. The audit fixes tablet navigation, narrow-screen overflow, touch dismissal, mobile CD clipping, spine publisher contrast and an invented unknown-artist credit. All 177 manga spines retain the requested uniform 235 px height. The CSV, schema, migrations, importer and original domain/database test files are unchanged. The original diagnostic is retained at `/foundation`.

Exact commands, implementation acceptance, screenshots, failures/fixes and unverified browser/device behavior are recorded in [STAGE2_AUDIT.md](STAGE2_AUDIT.md). The dependency audit remains nonzero with 11 existing findings. Remote image/metadata APIs, mutations, import/export and hosted deployment were not attempted.

## Stage 1 audit revalidation

The [Stage 1 audit report](STAGE1_AUDIT.md) records the latest exact commands, fixes, acceptance comparison and evidence. Current results: **38 unit + 17 integration + 2 actual workerd D1 tests pass**, with no failures or skips; clean locked installation, Astro/TypeScript checks, build, schema parity, seeded runtime smoke and empty/unavailable D1 states pass. The latest dependency audit reports **11 findings: 6 moderate, 4 high, 1 critical** (exit 1). Earlier results below remain historical evidence, including the earlier 17-finding audit.

The audit added tests for static-directory database/artifact rejection (including symlinks), the actual CLI reconciliation-report lifecycle, and rejection of an unstyled response by the smoke checker. HTTP smoke now requires layout CSS and sends a real overridden Host using `node:http`. An exploratory probe using Node `fetch` failed because it did not transmit the requested Host; that invalid probe is preserved in `data/generated/audit-host-fetch-invalid.txt`. Curl and the corrected HTTP client confirm the application rejects nonlocal hosts. No application failure was hidden by this correction.

## Stage 1 completion checks (before audit)

Executed 2026-10-21 America/Los_Angeles (2026-10-22 UTC). Runtime: Node 26.11.1, npm 12.2.1, built-in SQLite 3.53.4, TypeScript 5.9.3. Verified package matrix: Astro 5.18.2, Cloudflare adapter 12.6.13, React integration 4.4.2, React/React DOM 19.2.3, Tailwind 4.1.18, Drizzle ORM 0.45.4/Kit 0.31.8, Wrangler 4.151.3 and Workers types 5.20261022.1. The adapter separately pins Wrangler 4.59.2/workerd 1.20260114.0; the root Wrangler uses workerd 1.20261019.1. Both runtime paths were exercised.

| Command / check | Actual result |
| --- | --- |
| `npm install --cache /tmp/atelier-strawby-npm-cache --fetch-retries=0 --fetch-timeout=20000` | PASS: registry accessible; generated the first real lockfile |
| `npm install astro@5.18.2 drizzle-orm@0.45.4 wrangler@4.151.3 @cloudflare/workers-types@5.20261022.1 --cache /tmp/atelier-strawby-npm-cache --fetch-retries=0 --fetch-timeout=20000` | PASS: compatible pinned updates; normal peer resolution without force flags |
| `npm ci --cache /tmp/atelier-strawby-npm-cache --fetch-retries=0 --fetch-timeout=20000` | PASS: clean install from `package-lock.json`; evidence in `data/generated/npm-ci.txt` |
| `npm ls --depth=0` | PASS: pinned direct versions installed; no peer errors |
| `cp -n .dev.vars.example .dev.vars` | PASS: local-only development flags; file stays ignored |
| `npm run db:types` | PASS: actual Wrangler-generated project bindings; `--include-runtime false` uses the pinned Workers runtime declarations |
| `npm run db:generate -- --name foundation` (initial review config) | PASS: generated all 27 tables in the ignored schema review directory |
| `npm run test:schema` | PASS: typed schema agrees with the promoted baseline snapshot; reviewed and generated SQL agree on tables, column/default definitions, foreign keys, primary/unique keys, indexes/partial predicates and CHECK constraints; reviewed baseline initializes revision 0 |
| `npm run db:generate` (established `drizzle/meta/` history) | PASS: no schema changes; no extra baseline or numbered migration generated |
| `npm run db:migrate:local`, repeated | PASS: actual local Wrangler D1 executed 72 commands; repeat reports no pending migrations |
| `npm run seed:local`, repeated | PASS: imported 177 copies, then `already-imported` with 177; repeat evidence in `data/generated/d1-seed-repeat.txt` |
| `npm run seed:sample-cds` | PASS: four labeled demonstration CDs in local D1 |
| `npm run verify:seed` | PASS: independent persisted D1 counts, distributions, acquisition years, FK/subtype integrity, duplicate ownership pair and audit totals; 177 personal manga / 38 series / 4 excluded samples; `data/generated/d1-persisted-verification.txt` |
| `npm run test:d1` | **2 passed, 0 failed, 0 skipped**, real workerd D1; `data/generated/d1-test-results.txt` |
| `npm run check` | PASS: full Astro check and `tsc --noEmit`, including scripts/tests/server/components; final result: 45 files, 0 errors, 0 warnings, 1 async-function suggestion |
| `npm test` | **35 unit + 15 SQLite integration tests passed**, 0 failed/skipped |
| `npm run build` | PASS: Astro 5 Pages output, `dist/_worker.js/index.js`, client bundle, stylesheet, routes and headers |
| `npm run validate` after clean install | PASS: full check, all 50 offline tests and production build; `data/generated/stage1-validate.txt` |
| `npm run dev`; `npm run test:smoke -- --url http://127.0.0.1:4321` | PASS: actual Drizzle/D1-backed Astro response, React SSR counts, languages/publishers/dates, sample exclusion and privacy headers |
| `npm run preview:pages -- --port 8788`; `npm run test:smoke` | PASS: built worker returns 200 with the same seeded D1 totals; linked compiled CSS returns 200; `data/generated/pages-runtime.txt` and `data/generated/pages-smoke.txt` |
| `curl --silent --show-error --max-time 20 -H 'Host: atelier-strawby.example' --dump-header data/generated/pages-hosted-headers.txt --output data/generated/pages-hosted.html http://127.0.0.1:8788/` | PASS: simulated nonlocal Host fails closed with 503 and `Cache-Control: private, no-store`; this is local evidence, not hosted Access verification |
| Runtime graph scan: `rg -n 'node:(fs\|sqlite)\|seed-from-csv\|scripts/lib/normalize\|initial_collection.csv\|normalized-collection.json\|first b&n\|from sammy' dist` | PASS: no matches; ingestion, source CSV, private artifacts and acquisition-note text absent from deployed assets |
| `sha256sum initial_collection.csv` | PASS: unchanged `8e7b935ee024654b715c4e88ac406013105961ef3282aec7e0f88ebb35004a0a` |
| `sha256sum --check data/generated/artifact-digests.txt` | PASS: all three deterministic JSON artifacts remain byte-identical after the D1 runs |
| `npm run dev:offline`; `curl --silent --show-error --fail --max-time 20 --output data/generated/offline-served.html http://127.0.0.1:4322/` | PASS: the previously blocked SQLite diagnostic server now serves locally |
| `npm audit --json > data/generated/npm-audit.json` | **NOT CLEAN (exit 1): 17 total findings: 6 low, 6 moderate, 4 high, 1 critical**, including inherited dependency findings; see review below |

The D1 tests now verify sample idempotence/exclusion, genuine subtype mismatch rejection, invalid calendar-date rejection, retained duplicate ownership, repeat import after an owner edit, atomic rollback, staged invisibility, a real mid-import interruption followed by resume, revision finalization, and changed-source/mapping refusal. Their databases are disposable and separate from the seeded development database. No test is skipped and no SQLite substitute is used.

Initial full validation caught two TypeScript errors in the new schema-verification helper's inferred index row; explicitly typing its index name fixed them. The subsequent full validation passes. Unused schema callback parameters were removed without changing SQL. A first Wrangler update without matching Workers types was rejected by normal peer resolution; the matching type pin fixes it. No `--force` or `--legacy-peer-deps` was used.

Astro/Wrangler commands initially failed or emitted logging errors because the restricted sandbox could not write `~/.config/astro` / `~/.config/.wrangler`. The relevant checks were rerun with sandbox approval. Those environment failures are not counted as successful checks. Package lifecycle-script warnings remain under npm 12's defaults; packaged native binaries successfully ran the build and both workerd versions without blanket script approval.

### Dependency security review

Drizzle ORM 0.45.4 resolves the original [identifier-escaping advisory](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9); the maintainer identifies 0.45.2 as patched. Astro was updated to the available 5.x patch and direct Wrangler to 4.151.3. The fixed Pages-compatible adapter still pins its older Wrangler, so its inherited Miniflare/undici/ws findings remain alongside Astro/Sharp, adapter and Drizzle Kit/esbuild findings.

The critical [Astro AVIF optimization advisory](https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2) identifies Astro 7.2.8/Sharp 0.35.4 as the fix. This Stage 1 app uses the passthrough image service, fetches no artwork, exposes no image-processing flow, and rejects nonlocal collection reads. Those are scope observations, not a clean-audit or security guarantee. Other Astro/adapter advisories also require newer major versions. Moving beyond Astro 5/adapter 12 requires the separate Pages/platform decision documented in [DECISIONS.md](DECISIONS.md); it was not silently performed in this Stage 1 task. Audit output is preserved for review before any hosted release. Local functional acceptance passes; security-release readiness remains open.

## Initial Stage 1 offline checks (historical)

Executed 2026-10-21, America/Los_Angeles (late commands show 2026-10-22 UTC). Runtime: Node 26.11.1, npm 12.2.1, built-in SQLite 3.53.4. No installed Astro/Drizzle/Wrangler dependencies were available.

| Command / check | Actual result |
| --- | --- |
| `npm run seed:csv -- --input initial_collection.csv` (default filename also tested) | PASS: 177 copies, 38 series, 42 edition runs, 176 volume editions; 0 skipped source records; deterministic normalized/audit/statement artifacts |
| `npm run db:migrate:sqlite` | PASS: real SQL migration applied to a fresh file database; migration repeat also tested in memory |
| `npm run seed:sqlite` twice | PASS: first import persisted 177 copies; second returned `already-imported`; no added records |
| `sha256sum --check data/generated/artifact-digests.txt` after the second CLI seed | PASS: normalized JSON, validation summary, and parameterized SQL artifacts byte-identical across runs |
| `npm run seed:sample-cds -- --target sqlite` | PASS: four explicitly labeled samples, excluded from personal counts; idempotence covered in integration tests |
| `npm run verify:seed -- --target sqlite` | PASS: independent persisted counts, distributions, acquisition years, FK integrity, subtype coverage, duplicate pair, and audit count |
| `npm run test:unit` | **35 passed, 0 failed, 0 skipped** |
| `npm run test:integration` | **15 passed, 0 failed, 0 skipped**; fresh actual SQLite databases and the committed migration |
| `npm test` | **50 passed total**; output saved in `data/generated/test-results.txt` |
| `npm run preview:offline` | PASS: generated `data/generated/diagnostic.html` from actual persisted aggregate queries; test proves counts change with database writes and stored text is escaped |
| `sha256sum initial_collection.csv` | PASS: unchanged `8e7b935ee024654b715c4e88ac406013105961ef3282aec7e0f88ebb35004a0a` |
| Dependency-free domain/service TypeScript check with available TypeScript 5.9.3 | PASS for normalization modules, collection summary service, and local-access predicate; **not a full app/scripts check** |
| `npm install --cache /tmp/atelier-strawby-npm-cache --fetch-retries=0 --fetch-timeout=2000` | BLOCKED: registry DNS/network `EAI_AGAIN`. No lockfile generated; no successful install claimed |
| `npm run check` | BLOCKED: `astro: command not found` |
| `npm run build` | BLOCKED: `astro: command not found` |
| `npm run test:d1` | BLOCKED / 1 failed setup: `ERR_MODULE_NOT_FOUND` for Wrangler; no actual D1 assertions ran |
| `npm run dev:offline` | BLOCKED: listening on `127.0.0.1:4322` denied with `EPERM`; file diagnostic generated instead |
| Drizzle Kit generation/parity, Wrangler migration/type generation, Astro page/Pages runtime smoke, hosted deployment | NOT VERIFIED; dependencies/runtime access unavailable |

The limited TypeScript check used the already installed compiler without modifying that other project:

```bash
node /home/josie/Documents/divvy/node_modules/typescript/bin/tsc \
  --noEmit --strict --noUncheckedIndexedAccess --allowImportingTsExtensions \
  --module nodenext --target esnext \
  src/domain/normalization/*.ts \
  src/server/services/collection-summary.ts src/server/auth/local-access.ts
```

An attempted wider scripts/test type check was blocked by absent Node type declarations. `node:test` executes TypeScript by stripping annotations, which is not a type check. The completed domain-only check and passing runtime tests are reported separately from the outstanding full check.

The first normal test runner attempt used child-process isolation, which this sandbox denied. The committed runner registers `node:test` suites in-process; each integration test still owns a fresh disposable database. Timezone assertions change and restore `TZ`, confirm the runtime's UTC/Los Angeles/Tokyo offsets, then assert unchanged date-only parsing. A genuine initial SQL-identifier validator defect (digits in `source_sha256`) was fixed before persistence checks passed. No tests were removed or marked skipped to obtain passing results.

The 15 database tests cover migration repeatability; independent persisted invariants; exact no-op reimport including owner edits and timestamps; changed-source/mapping refusal; hidden interruption/resume; batch rollback; duplicate ownership and subtype mismatch rejection; enum/date/uniqueness constraints; aggregate fan-out avoidance; sample exclusion; multi-disc CD/catalog/track modeling; artwork/reference constraints; SQL parameter binding; competing-source prevention; and diagnostic output from changing database state.

The actual D1 test is kept separate under `tests/d1/` and uses Wrangler's local workerd binding. It does not mock D1 or fall back to SQLite. Passing SQLite tests must not be read as evidence that the D1 driver, adapter, or Pages build ran.

See [STAGE1_VALIDATION.md](STAGE1_VALIDATION.md) for the data summary and unresolved source facts. The previously blocked application/D1 checks are superseded by the completion record above.

## Checks actually performed during planning

| Check | Method | Result |
| --- | --- | --- |
| Workspace and instruction discovery | `pwd`, `rg --files`, ancestor `AGENTS.md` checks | Two initial project files: `project_specification` and `initial_collection.csv`; no applicable AGENTS.md found |
| Existing version-control state | `git status --short --branch` | Directory is not a Git repository; no Git status/diff/commit verification available |
| Full requirements review | Read all 89 lines of `project_specification` | All sections mapped into ROADMAP.md R01–R27 |
| CSV structural review | Python standard-library `csv.reader`, all records inspected | 9 columns, 177 data records; 6 domain columns and 3 spreadsheet-legend columns |
| Source identity | SHA-256 over unchanged CSV bytes | `8e7b935ee024654b715c4e88ac406013105961ef3282aec7e0f88ebb35004a0a` |
| Independent normalization audit | Temporary in-memory Python analysis; no generated seed or application files | 38 series under specified alias mapping; all 177 ownership records retained |
| Acquisition audit | Parse M/D/YYYY calendar dates, group by year | 172 valid dates, 5 missing; 55 distinct dates; 2021=21, 2022=96, 2023=26, 2024=29 |
| Note audit | Stateful cascade analysis under documented blank-note policy | 57 `|` and 17 terminators; 97 nonempty resolved notes; no unresolved markers in this file |
| Language audit | Apply explicit PRD mappings; flag default EN | EN=167, JP=9, KR=1; 163 EN rows are inferred defaults, not verified editions |
| Duplicate audit | Group series/number/language/publisher without deleting rows | One repeated Vol 1 candidate at data records 158 and 173; retained as two owned copies |
| Provider/platform research | Read official Astro, Cloudflare, Drizzle, Open Library, MusicBrainz/CAA, Apple, AniList, Discogs documentation | Confirmed material version/caching/rate-limit constraints; links in architecture and decisions |
| MangaDex documentation access | Tried official documentation endpoints through browsing tools | Documentation retrieval failed; API integration/availability not verified |

`wc -l` reports 177 newline characters for the CSV, but that is not a record count: the file contains a header plus 177 data records and has no final newline. The CSV parser's record count is authoritative.

The independent Python audit is exploratory analysis, **not** the required `scripts/seed-from-csv.ts` implementation. Language/edition assumptions are not external bibliographic verification. No live cover download, R2 write, or D1 operation was performed.

## Regression cases derived from the original data

| Case | Expected assertion |
| --- | --- |
| Ignored columns | Empty header G, Language Legend H, empty header I cannot enter domain data |
| Whitespace | `Kodansha ` and `Kakifly ` normalize without changing intended text |
| First B&N haul | Five records dated 2021-10-27 share `first b&n manga trip` after expansion |
| Promised Neverland Vol 5 | Data record 12 receives `:skull:` from the preceding active note |
| My Happy Marriage Vol 1 | Data record 139 receives `from sammy c:` |
| Cross-date cascade | Quintessential Quintuplets Vol 14 retains 2022-08-17 and inherited `box set` |
| Sammy Wotakoi haul | Volumes 2–6 carry `from sammy <3` as safe text |
| Christmas | 19 records on 2022-12-25 carry `xmas gifts` |
| SPY x FAMILY Vol 3 | Data record 121 receives Tatsuya Endo, not the nearby row named by a one-based reading of the PRD |
| Fruits Basket: Illustrations | Data record 154 receives Natsuki Takaya and Yen Press |
| Missing creator/publisher | Records 174–176 filled Saka Mikami/Kodansha; 177 filled inee/Kadokawa |
| Parent series aliases | 42 input title spellings reduce to 38 canonical series with original edition titles preserved |
| K-ON! | Four JP Houbunsha and four EN Yen Press copies under one parent |
| A Sign of Affection | Eight EN, one KR, one JP owned records under one parent |
| Repeated owned Vol 1 | Records 158 and 173 remain two items, with the latter's date null |
| 86 gaps | Actual owned set 1,2,3,4,7 yields internal gaps 5,6 |
| Unknown dates | Five undated rows remain null through storage, display, export, and restore |

## Future test layers

### Domain and parser tests

Use table-driven unit tests around normalization, not snapshots of the implementation's own output. Assert meaningful examples and complete invariants independently. Cover quoted commas/newlines, BOM, duplicate empty headers, whitespace, missing required fields, invalid dates, ordinary note punctuation, both terminator spellings, orphan `|`, orphan terminator with same/different/missing dates, blank reset, and explicit cascade across dates.

Check every correction by semantic identity and expected old value, original display-text preservation, stable seed IDs, idempotent repeat import, preserved owner edits, same-edition duplicate ownership, and language provenance. Test synthetic cross-language numbering, decimals/special labels, collector's numbering, uncertain omnibus packaging, and deterministic memory-tag extraction without overtagging unrelated gifts.

### D1 integration tests

Apply actual migrations to disposable local Wrangler D1. Exercise FK/check/uniqueness constraints, copy/subtype integrity, joins, sorted volumes/tracks, alias grouping, summary DTOs, atomic item updates, stale-version rejection, and failed-batch rollback. Test staged import invisibility, interruption/resume, final counts, duplicate file detection, and changed-file conflicts.

Compare aggregate queries with direct ownership counts to catch fan-out from creators/tags/labels. Assert baseline publisher totals sum to 177. When there are multiple credited authors, define per-author counts as owned records credited to that author; percentages can overlap and should not be presented as shares summing to 100%.

Do not assume a successful in-memory SQLite test proves D1 compatibility. Use D1's actual local runtime path and verify critical behavior in hosted preview before production.

### Metadata and image tests

Use clearly identified recorded/synthetic provider responses for deterministic failure scenarios: no candidates, multiple editions, malformed responses, unavailable fields, JP/EN mismatches, exact vs. release-group art, multiple discs, 404/403/429/503, timeout, abort, and stale response races.

Fixtures are test inputs, never a hidden production provider. Separately run a small set of live lookups and record provider/date/outcome. Avoid live-network unit tests and uncontrolled provider traffic.

Test cache key normalization and adapter versions, cache hits with no upstream calls, negative-cache expiry, shared concurrent provider throttling, transient failures not cached as missing, and preservation of manually confirmed values. For images, verify allowed MIME/signature, byte cap, all redirect destinations, R2 reuse after process restart, absent object behavior, and D1-reference failure after upload. Confirm source-specific external-delivery policies.

### Browser, accessibility, and responsive tests

Playwright flows: shelf→filter/search→open/close detail→change view; back/forward/direct detail URL; manga and CD add→lookup/manual save→edit→reload; import preview→commit/retry; export/restore; timeline→detail; stats after an edit.

Cover 360, 390, 768, 1280, and 1440 px viewports, light/dark mode, reduced motion, keyboard-only use, screen magnification at 200%, missing images, empty database, no search matches, slow responses, and API errors. Check safe areas and mobile virtual-keyboard interactions manually on an available mobile browser; emulation alone does not verify an actual iPhone/Android device.

Run axe on shelf, both detail dialogs, editor, imports, timeline, and stats; manually check reading order, headings, labels, announcements, focus trap/return, Escape, chart tables, non-color cues, and spine/jewel-case controls. Record unavailable physical devices/browsers as untested.

### Access, exports, and operational tests

Reject absent/forged/expired/wrong-audience Access credentials; check the production domain, direct Pages origin, and previews. Verify CSRF/origin enforcement, request limits, escaped metadata/notes, provider URL validation, and no cache/static-asset exposure of private payloads.

JSON export/restore must round-trip relational domain data, nulls, IDs, sample scope, and provenance. CSV must round-trip ordinary ownership fields and handle formula-like cell starts safely; document its spreadsheet sanitization and rely on JSON for byte-exact notes. Exporting cover references does not mean backing up R2 bytes.

Exercise clean local setup, fresh hosted preview, persistent writes in a second session, database migration recovery, backups, R2 inventory restoration, and redeploy without reseeding. Check logging without notes/tokens. A rollback of Pages assets is not a database rollback.

## Planned commands and evidence policy

The following table is the original Stage 0 plan. At that time none of these project scripts existed; consult the Stage 1 execution table above for their current status:

| Planned command / check | Purpose | Stage |
| --- | --- | --- |
| `npm ci` | Reproducible locked install | 1 onward |
| `npm run check` | Astro + strict TypeScript checks, including scripts/server/client | 1 onward |
| `npm run test:unit` | Parser/domain/provider contract cases | 1 onward |
| `npm run test:integration` | Disposable Wrangler D1/R2 integration | 1 onward, expanded in 2/4/5 |
| `npm run db:migrate:local` | Apply reviewed migrations locally | 1 onward |
| `npm run seed:csv -- --input initial_collection.csv` | Deterministic local dataset and report | 1 |
| `npm run verify:seed` | Independent persisted invariant checks | 1 onward |
| `npm run covers:cache -- --resume` | Actual resumable enrichment with provider policy | 2 |
| `npm run build` | Pages-compatible deployable output | 1 onward |
| `npm run preview:pages` | Run built output through local Pages runtime | 1 onward |
| `npm run test:e2e` | Browser regression and selected accessibility checks | 3 onward |
| Lighthouse / manual device review | Measured performance and usable responsive flows | 3 and 5 |
| Hosted preview/production smoke | Real account bindings, identity, persistence, provider/cache behavior | Relevant hosted stages, final gate in 5 |

At each stage, record exact commands, environment/versions, date, result, count of tests, relevant failures/fixes, and untested external dependencies. Run relevant checks and required regressions; do not claim planned scripts as executed or add redundant tests for static text/style changes.

## Planning documentation verification

Executed an inline Python standard-library validation through the shell execution tool. It checked all five document files, balanced Markdown fences, every local Markdown link target, exactly five stage sections, and all R01–R27 traceability entries. It also asserted the unchanged CSV SHA-256, 178 parsed records including the header, 9 columns per row, 42 input titles/38 normalized series, year counts, known haul sizes, duplicate-record positions, and the actual 86 owned set. It verified that `src/`, `package.json`, and `scripts/` had not been created.

**Result: PASS.** These are documentation/data-audit checks. Application type checking, builds, unit/integration/browser suites, live provider enrichment, and Cloudflare deployment remain **not run** until their implementation stages.
