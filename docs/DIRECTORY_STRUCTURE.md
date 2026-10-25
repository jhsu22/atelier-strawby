# Delivered source layout

```text
atelier_strawby/
  project_specification          Original complete product specification
  initial_collection.csv         Immutable 177-copy input (includes personal haul notes)
  package.json / package-lock.json  Pinned dependencies and commands
  astro.config.mjs               Astro 5 SSR, React, Tailwind, Pages adapter
  wrangler.toml                  Hosted Pages config (Git builds); preview_* IDs for local dev
  wrangler.hosted.json.example   Hosted config template, no real resources/credentials
  .dev.vars.example             Loopback development auth and variable reference
  eslint.config.mjs              ESLint/TypeScript/Astro checks
  playwright.config.ts           Desktop/mobile Chromium against disposable Pages/D1
  drizzle/
    0000_foundation.sql           Relational catalog, ownership, provenance and caches
    0001_edition_medium.sql       Additive manga/light-novel/book classification
    0002_request_limits.sql       Barcode-scan rate-limit counters
    0003_private_notes.sql        Per-copy note privacy (existing notes become private)
    0004_acquisition_batches.sql  Logged hauls: shared date and store per acquisition
    meta/                        Drizzle snapshots and migration journal
  data/sample-cds.json            Four labeled demonstration CDs
  public/
    fonts/                       Self-hosted fonts and licenses
    templates/                   Manga and CD CSV import templates
    images/                      Provider attribution artwork
    favicon.svg / _headers       Public icon and static response headers
    sw.js                        Offline shelf service worker (allowlisted cache)
    manifest*.webmanifest        Installable app manifests (shared shelf and /edit)
    icons/                       App icons rendered by scripts/generate-app-icons.ts
  src/
    config/brand.ts              Shared brand strings
    layouts/AppLayout.astro      HTML shell, theme setup and skip link
    pages/
      index.astro                D1-backed shelf with initial-load failure state
      foundation.astro           Read-only collection diagnostic
      api/                       Authenticated library, CRUD, transfers, metadata,
                                 released volumes and artwork endpoints
    middleware.ts                Access authorization and mutation-origin boundary
    components/
      shelf/                     Media navigation, search/filter, grid and spines
      details/                   Manga/book/CD detail panels
      manage/                    Copy editor and transfer workflows
      scan/                      Barcode scanning, review and "Do I own this?"
      haul/                      Log a haul: shared details, ranges, stack scanning
      timeline/ / stats/         Acquisition feed and collection analytics
      releases/                  External released-volume lookup
      covers/ / brand/ / ui/     Artwork fallback, visual identity, drawer, error boundary
    domain/
      normalization/             CSV, notes, dates, corrections and memory tags
      *.ts                       Shared validation, library matching, gaps and insights
    server/
      auth/                      Local loopback and signed owner Access checks
      db/                        Drizzle schema, D1 clients, atomic Store interface
      repositories/              Fixed SQL read models
      services/                  CRUD, import/export, chunked backup restore and summaries
      metadata/                  Provider clients, throttling, caching and artwork
      http/                      Bounded JSON requests and safe API errors
    styles/                      Design tokens, fonts, layouts and component CSS
    env.d.ts / worker-configuration.d.ts  Runtime bindings
  scripts/
    seed-from-csv.ts / lib/       Deterministic normalization and resumable local seeding
    seed-sample-cds.ts            Optional demonstration data
    verify-*.ts                  Seed, insights, schema and Wrangler migration checks
    cache-covers.ts               Local resumable artwork enrichment
    generate-app-icons.ts         Renders the installable-app icons from the brand mark
    deploy.ts                    Hosted-config guard, staging and Pages upload wrapper
    package-release.py           Source ZIP and checksum manifest (Python 3)
    browser-server.ts            Disposable built-worker browser-test server
    run-tests.ts                 Node unit/integration/D1 suite runner
    dev-offline.ts / render-diagnostic.ts  SQLite verification tools
  tests/
    unit/                        Normalization, domain, auth and validation
    integration/                 SQLite services, CLI, providers and transfer integrity
    d1/                          Real local workerd D1/R2 persistence and restore tests
    e2e/                         Browser workflows, axe, keyboard and scale checks
    helpers/                     Shared SQLite/D1 scenarios and fixtures
  docs/                          Stage reports, full matrix, operations and user guide
```

Generated/private paths are excluded from version control and the ZIP: `node_modules`, `dist`, `.astro`, `.wrangler`, `.dev.vars`, `.env*`, `wrangler.hosted.json`, `data/generated`, test traces/screenshots, and `releases`. The ZIP includes all application source, tests, scripts, migrations, templates, font licenses, lockfile, original specification and initial CSV. It does not include the owner's edited live database or cached cover files. Reinstall dependencies and build locally.
