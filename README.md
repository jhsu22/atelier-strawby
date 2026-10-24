# Atelier Strawby · Strawby Stacks

Stage 5 completes local release QA, Cloudflare Pages deployment configuration, the requirements audit and source packaging. **This is a locally verified release candidate, not a production-ready hosted deployment.** No deployment occurred. Eleven dependency findings remain (4 moderate, 6 high, 1 critical), and hosted Access/D1/R2 and recovery require manual setup and verification.

Start with the [Stage 5 testing and readiness report](docs/STAGE5.md), [complete requirements matrix](docs/REQUIREMENTS_MATRIX.md), [deployment and local setup guide](docs/DEPLOYMENT.md), [user guide](docs/USER_GUIDE.md), [directory structure](docs/DIRECTORY_STRUCTURE.md), and [security review](docs/SECURITY_REVIEW.md).

```bash
npm ci
# Fresh checkout only; preserve an existing .dev.vars and database.
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run seed:local
npm run seed:sample-cds
npm run dev
```

Release checks: `npm run release:verify`. Build the complete source archive: `npm run release:zip` (Python 3), producing `releases/atelier-strawby-stage5.zip` and its SHA-256 checksum. The archive includes source, tests, docs, migrations and the original CSV; it excludes secrets and the owner's edited live state. Hosted setup uses `wrangler.hosted.json.example`, never the local placeholder resources. Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md) before using the deployment commands.

The original baseline is 177 manga copies across 38 series and four labeled sample CDs. Existing owner edits, the original CSV and both reviewed migrations are preserved. Earlier-stage reports are historical; the Stage 5 report controls current verification status.

## Browse the application

After the local D1 setup below, run `npm run dev` and open **http://127.0.0.1:4321**. The main page is the new shelf; **/foundation** retains the Stage 1 database diagnostic and its counts/distributions. Search, filters, media/view changes and open details are reflected in the URL. Theme preference is stored locally. Use the refresh button to query D1 again.

Use **Add to collection** (mobile **Add**) to create a manga volume or CD; open a detail drawer to edit/delete a physical copy or add another. Optional metadata suggestions use MangaDex, optional [Google Books](docs/GOOGLE_BOOKS.md) ahead of Open Library, and MusicBrainz/Cover Art Archive, with an explicitly digital iTunes fallback. Manual entry and artwork overrides remain available. Representative artwork is labeled and unresolved artwork retains the designed typographic fallback. Open a manga or light-novel series to use **Released & missing volumes**: choose an edition, search released volumes, and compare its catalogued numbers with your current owned copies. [Release lookup rules](docs/RELEASED_VOLUMES.md).

**Import / export** provides validated previews, duplicate choices, resumable CSV imports, full JSON backups/restoration and separate manga/CD CSV downloads. Search combines with media, publisher/label, language, year, memory tag and edition/format filters. The **Haul timeline** combines exact acquisition dates, original memories and cover artwork; **Collection stats** shows distributions, yearly acquisitions and personal insights. Both are available from desktop and mobile navigation.

`npm run test:e2e` builds the worker and provisions disposable seeded D1/R2 automatically, then runs Chromium desktop/mobile interactions and axe checks. It uses `/usr/bin/chromium` when available, or Playwright's installed Chromium; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to select another executable. Only set `STRAWBY_TEST_URL` for an already-running **disposable seeded** Pages runtime: management tests perform real writes. See [TESTING.md](docs/TESTING.md).

## Run the verified offline data foundation

Requires Node **22.18+** (tested with 26.11.1), including built-in TypeScript stripping and `node:sqlite`. The seed/migration/diagnostic commands use Node built-ins. The combined test suites now include Stage 3 validation and require `npm ci`. Node 22 may print an experimental SQLite warning.

```bash
npm run seed:csv -- --input initial_collection.csv
npm run db:migrate:sqlite
npm run seed:sqlite
npm run seed:sample-cds -- --target sqlite
npm run verify:seed -- --target sqlite
npm test
npm run preview:offline
```

Open `data/generated/diagnostic.html` for the database-backed counts. `npm run dev:offline` serves the same diagnostic at `http://127.0.0.1:4322` where local listening sockets are permitted. The diagnostic is a verification aid; it is not the Astro application or a substitute for D1 verification.

`data/generated/collection.sqlite` is disposable verification state. The application **always reads D1**. There is no automatic fallback, sync between stores, or second production database. The HTML and JSON artifacts are private, ignored build inputs; never copy them into `public/` or deployment assets.

## Run Astro and local Cloudflare D1

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:types
npm run db:migrate:local
npm run seed:local
npm run seed:sample-cds
npm run verify:seed
npm run verify:insights
npm run test:d1
npm run test:schema
npm run check
npm run dev
```

Visit `http://localhost:4321`. The Astro shelf reads normalized D1 records through the read service and hydrates a React browsing island. It does not load generated collection JSON or hardcode library content. `/foundation` preserves the original aggregate diagnostic and its React-rendered counts.

```bash
npm run build
npm run preview:pages
```

To fill in missing artwork for the existing collection, run `npm run covers:cache -- --dry-run` to preview, then `npm run covers:cache`. The utility tries an unambiguous MangaDex match, then an Open Library edition with the same series, volume number, language and publisher/imprint. It caches the image in local R2, and writes a private report to `data/generated/cover-cache-report.json`. Rerun it to resume after interruption or rate limiting; `--limit N` bounds the series looked up per run and `--retry` bypasses cached failures. It only targets local Wrangler state. See [the Stage 3 guide](docs/STAGE3.md#automated-cover-caching-utility).

With that local Pages server running, use `npm run test:smoke` in another terminal. It checks the seeded D1 totals, React-rendered counts, sample exclusion, private response headers, CSS delivery, and nonlocal Host rejection. Use `npm run test:smoke -- --url http://127.0.0.1:4321` to check the Astro development server, which supplies inline layout CSS. These are HTTP runtime checks; later-stage browser/device tests remain separate.

The build is configured for **Astro 5 / `@astrojs/cloudflare` 12 / Cloudflare Pages**. Do not upgrade to a newer adapter major without revisiting the platform choice. See [Astro 5 Cloudflare documentation](https://v5.docs.astro.build/en/guides/integrations-guide/cloudflare/), [Tailwind's Vite setup](https://tailwindcss.com/docs/installation/framework-guides/astro), and [Drizzle D1](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1).

Direct versions are pinned in `package.json`, and `package-lock.json` records the installed dependency graph. Verified versions include Astro 5.18.2, Cloudflare adapter 12.6.13, Drizzle ORM 0.45.4/Kit 0.31.8, and Wrangler 4.151.3. The adapter retains its own pinned Wrangler 4.59.2; both runtime paths were exercised. Peer resolution and a clean `npm ci` succeed without force flags. See the security-review caveat in [TESTING.md](docs/TESTING.md) before considering hosted release.

## Import behavior and files

`scripts/seed-from-csv.ts` accepts `--input`, `--output`, and `--target artifacts|sqlite|d1-local`. The default target creates deterministic artifacts without touching a database. `--database` selects a file only for the explicit SQLite verification target. CLI artifact and database destinations under `public/` or `dist/` are rejected, including symlink destinations. Remote seeding is deliberately unavailable in Stage 1.

Generated files:

- `normalized-collection.json`: normalized relational tables, stable UUIDs, original domain fields, corrections, row provenance, and expanded notes.
- `import-statements.json`: bound SQL statements for the staged importer; use the seed command to manage the batch lifecycle, not this file alone.
- `validation-summary.json`: counts, distributions, all correction outcomes, skipped records, and source warnings/errors.
- `reconciliation-required.json`: candidate report when changed source bytes or mapping rules encounter an existing import. This is a conflict report, not an automatic reconciliation tool.
- `diagnostic.html`: counts read from the persisted verification database at generation time.

An RFC 4180 state machine handles quoted commas/newlines, escaped quotes, BOM, CRLF, and missing final newline. It explicitly selects the six domain columns, ignoring both empty legend headers and `Language Legend`. Blank/legend-only records are reported and reset note state. Invalid noncollection records, malformed columns, invalid dates, and conflicting corrections block persistence.

Source record numbers are **one-based data-record indexes excluding the header**; they are not physical line numbers when a quoted field contains a newline. PRD correction indexes are zero-based. Each correction matches title/volume and expected old value, and records its PRD index. This fixes the exact intended records even if a blank row is inserted. Source values remain in the audit.

Both `\/` and the CSV's two-backslash closing marker are recognized exactly. A closing marker copies then clears the active note; a blank note clears state; an orphan closing marker can reuse only the immediately previous resolved note with an equal, known calendar date. Explicit cascades can span dates. All acquisition dates remain validated calendar strings with no timezone conversions.

Identical imports are no-ops, including after owner edits. Catalog rows use explicit conflict targets; copies use independent source identities. Changed file bytes or mapping version require reconciliation, rather than adding another 177 copies. Small atomic batches stage records; collection queries hide them until finalization verifies item/subtype/audit counts. Interrupted imports resume by stable IDs. Do not manually mark an incomplete import complete.

## Schema and migrations

The typed schema is `src/server/db/schema/index.ts`; the reviewed SQL is `drizzle/0000_foundation.sql` plus the additive `drizzle/0001_edition_medium.sql` (the manga / light novel / book medium of an edition). Existing local databases need `npm run db:migrate:local` once; `npm run test:schema` checks every migration against the latest Drizzle snapshot. There are 27 tables for catalog entities, manga edition runs and volume editions, owned items, CDs/releases/media/tracks, credits, tags, provenance, optional artwork references, metadata cache, and import state. No artwork is fetched in Stage 1.

Multiple owned records can reference the same volume edition or CD release. Composite foreign keys enforce matching manga/CD subtypes. Application batches and finalization ensure each committed item has its required subtype; a parent-only SQL insert is not a supported mutation. Foreign-key, enum, uniqueness, calendar-date, and positive-position checks live in SQL as well as domain validation.

The baseline SQL was authored offline and has now been compared with Drizzle Kit output. `drizzle/meta/` establishes its snapshot/journal history without changing or reapplying the existing baseline. `npm run test:schema` compares the typed schema with that snapshot and compares the reviewed SQL's 27 tables, columns/defaults, foreign keys, indexes (including partial predicates), and CHECK constraints with generated SQL in fresh databases. The reviewed migration additionally initializes the collection revision. `npm run db:generate` now writes incremental migrations under `drizzle/`; it reports no changes for the current schema. Review every generated migration before applying it. Wrangler remains the migration executor; the SQLite adapter is only a verification harness.

## Scope, samples, and hosting boundary

Four deliberately unresolved CD definitions live in `data/sample-cds.json`; provenance points to the original specification. They carry `is_sample=1` and no invented acquisition dates, label/catalog numbers, media formats, or tracklists. An unspecified Hirasawa album is explicitly labeled unresolved. Personal counts exclude all four.

Stages 1–3 retain the approved `src/{config,components,domain,layouts,pages,server,styles}`, `scripts`, `data`, `drizzle`, `tests`, and `docs` structure. Stage 3 adds server-side collection services and authenticated APIs within it. Stage 4 adds timeline and analytics within the existing architecture. Hosted deployment remains separate work.

`wrangler.toml` uses local placeholders for `DB` and `COVERS`. Its preview/production environments are unprovisioned; create separate D1/R2 resources and bind them explicitly before any hosted verification. Hosted requests require a configured Cloudflare Access owner policy, verified JWT, exact origin and environment-specific bindings. Configuration is documented in [STAGE3.md](docs/STAGE3.md). Local access requires both `.dev.vars` flags and a localhost URL. No hosted deployment or remote collection writes have been attempted.

## Validation scripts

`npm test` runs the preserved Stage 1 normalization/SQLite suites plus Stage 2 browsing and Stage 3 CRUD, transfer, provider, authentication and search checks using `node:test`. `npm run test:d1` runs separate real Wrangler/workerd tests and fails if dependencies are absent; it never silently substitutes SQLite. `npm run check` runs Astro and TypeScript checks; `npm run validate` runs those checks, offline suites, and the Astro build. Stage 1's local functional gate also requires `test:schema`, `test:d1`, `verify:seed` against D1, and `test:smoke` against the built Pages server. Dependency audit findings are recorded separately and remain unresolved.
