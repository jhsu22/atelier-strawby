# Complete requirements audit

Audit date: 2026-10-24. Source: the complete [original specification](../project_specification), the existing Stage 1–4 implementation, and the Stage 5 release request. This records observed behavior, not the mere existence of named components. The original filename requested in the specification is represented by the supplied `initial_collection.csv`; normalization tests assert its original SHA-256 and all 177 records. Prior-stage follow-ups (books/light novels and Google/released-volume lookup) are retained.

Status legend: **V — Implemented and verified**, **U — Implemented but not verified**, **P — Partially implemented**, **N — Not implemented**. “Verified” is limited to local automated/runtime evidence unless explicitly stated. It never implies a hosted production deployment or coverage of every physical device/provider match. Exact test counts and remaining release gates are in [STAGE5.md](STAGE5.md).

## Architecture and design (original sections 1–2)

| Requirement | Status | Evidence / boundary |
| --- | --- | --- |
| Product naming: Strawby Stacks / The Strawby Library | P | Central brand strings retain both names, but the current visible shell/document title uses Atelier Strawby. Existing Stage 2 branding retained; literal original display naming is not fulfilled. |
| Astro 5 + TypeScript and React interactive islands | V | Type checks, production Pages worker build, actual Chromium hydration and interactions. |
| Tailwind CSS and Lucide icons | V | Vite integration, generated CSS delivery smoke and rendered icons in browser screens. |
| D1 persistence through Drizzle-compatible schema/read model | V | Real workerd D1 CRUD, migration, reopen and restore suites; owner-edited local state preserved. |
| Cloudflare Pages architecture | V | Adapter 12 advanced-mode output runs under installed Wrangler Pages runtime. |
| Actual hosted Pages and D1 operation | U | Hosted template and wrapper provided; no account/resources/deployment verified. |
| Automated manga title/volume artwork fetching and caching | V | Resumable CLI, MangaDex and Open Library edition matching; real local R2 cache/reopen tests; typed fallback. Current external coverage is not guaranteed. |
| CD MusicBrainz + Cover Art Archive metadata/tracklists, iTunes fallback | V | Provider-fixture integration tests; multi-disc metadata saved/read in D1 and browser; fallback identified as digital. |
| Warm editorial bookstore aesthetic | V | Existing cream/espresso/red/sage tokens, typography, physical cover/spine styles; desktop/mobile screenshots and layout assertions. Aesthetic judgment remains subjective. |
| Exact original hex palette and light/dark preference | P | Theme persistence and contrast scans pass. The established Stage 2 palette uses paper `#faf7f2`, ink `#181715`, strawberry `#d41b35` and leaf `#3f7e50`, rather than the original exact hex values. Retained to preserve the existing design. |
| Serif headers, sans body, monospace metadata | P | Newsreader editorial leads, Inter body and JetBrains Mono metadata are delivered locally with licenses. Major headings use Geist sans in the established design, so the literal all-serif heading treatment differs. |
| Sticky mobile Shelf, Search/Filter, Timeline, Stats, Add navigation | V | Navigation and viewport sweeps, including tablet breakpoints, in library/insights browser suites. |
| Thumb-friendly pills; 2–3 mobile / 5–7 desktop grid | V | Browser density/overflow assertions at 320–1600 px and filter interactions. |
| Mobile bottom sheet, desktop detail panel | V | Touch dismissal, Escape/focus restoration, dialog scrolling and width tests. |
| Series cover cards with owned-count badges; cover #1 or latest | P | Real 38-series shelf, counts and artwork/fallback rendering verified. Artwork selects the first available owned-copy cover, which can be an intermediate volume; it does not guarantee #1/latest. |
| Square jewel-case CD cards with hinge/obi and interactive lid | V | CD drawer interaction, populated-release fixture and narrow layout tests. |
| Manga and CD virtual spine shelf | V | All physical copies represented, including repeated editions; browser switch/open/state tests. |

## Deterministic ingestion (original section 3)

Each row below is exercised by `tests/unit/normalization.test.ts`; persisted outcomes are also checked by the seed/integration/D1 suites.

| Requirement | Status | Evidence / boundary |
| --- | --- | --- |
| `scripts/seed-from-csv.ts`, deterministic normalized series/volumes/CD tables | V | Stable identities, idempotent import, relational schema and repeat-import scenarios. |
| Account for all 177 manga rows | V | Source hash/row count, 177 copies, 38 series, 42 edition runs, 176 volume editions. |
| Ignore spreadsheet legend columns G/H/I | V | Six domain columns selected; legend content absent from normalized rows and audit snapshots. |
| Trim all domain fields | V | Publisher/author whitespace examples and general fixture assertions; raw provenance retained. |
| Forward-fill real notes through `|` | V | Stateful sequential fixtures and exact source notes. |
| Apply `\/` then clear active note | V | Both observed slash-marker spellings tested, with no cross-batch leakage. |
| Orphan end marker: only copy previous same-date note, otherwise null | V | Same-date and different-date fixtures; source anomalies remain explained. |
| Merge Girls Last Tour spelling | V | Two spellings share one canonical parent. |
| Normalize Yoshitoki Ōima | V | Exact author correction assertion. |
| SPY x FAMILY vol 3 → Tatsuya Endo | V | Semantic source-record correction with original specification index 120 retained. |
| Fruits Basket: Illustrations → Natsuki Takaya / Yen Press | V | Author and publisher assertions; distinct from Collector's Edition parent. |
| Fragrant Flower vols 1–3 → Saka Mikami / Kodansha | V | All three correction records checked. |
| LOVE BULLET → inee / Kadokawa | V | Final source-record correction checked. |
| EN / JP / KR field on each volume | V | Runtime and database enum constraints, baseline 167 EN / 9 JP / 1 KR. Unspecified EN is marked assumed. |
| A Sign of Affection KR + Yubisaki JP share parent | V | One parent, distinct edition titles, language-specific ownership. |
| Kaoru Hana JP shares Fragrant Flower parent | V | Canonical linkage and edition identity tests. |
| K-ON! Houbunsha JP vs Yen Press EN | V | Publisher-based disambiguation with both runs retained. |
| Project SEKAI anthology JP | V | Exact title/publisher language rule. |
| Both Guy She Was Interested In vol 1 physical copies retained | V | Separate ownership IDs under one edition; browser duplicate-count/detail checks. |
| Malformed CSV/dates/corrections fail safely | V | RFC 4180 tests, source-row errors, failed-batch rollback and reconciliation reports. |

## Product workflows (original section 4)

| Requirement | Status | Evidence / boundary |
| --- | --- | --- |
| All Media / Manga / CDs switcher; manga by series, CDs by artist/album | V | Real seeded switcher and artist-shelf tests. Books is an additional retained category. |
| 4–5 Japanese/soundtrack sample CDs | V | Four explicit samples, idempotently seeded and excluded from personal totals. Unknown release details are not invented. |
| CD CSV, Discogs CSV and manual entry | V | Validated imports, explicit Date Added mapping, multi-label/media/track preservation and browser manual CRUD. |
| Manga metadata: author, publisher, languages, owned count | V | Persisted read service and real drawer assertions. |
| Numerical owned-volume grid, covers/dates/badges/edition tags/notes | V | Sorting, language-separated copies, exact cascade memories, loaded/failing artwork and detail tests. |
| Missing-volume gap toggle | V | Internal gaps by edition/language, duplicate handling and ambiguous/omnibus safeguards; browser toggle. No claim about unpublished/unowned tail volumes. |
| CD artist/year/label/format/catalog/tracklist/acquisition note | V | Real CRUD plus populated multi-disc fixtures; unknown fields honestly unresolved. |
| Instant fuzzy search: title, alternate Japanese title, creator, publisher/label, notes | V | Unit matching assertions, combined browser filters and large-library search. |
| Publisher chips/filters | V | Dynamic publisher/label options from library, matching-copy filters. |
| EN/JP/KR filters | V | Combined language, publisher and media tests. |
| Memory tags: Sammy, Kinokuniya, Box Sets, Korea, Proxy | V | Deterministic extraction from original notes, manual tag editing and timeline/browser filters. |
| Chronological haul feed grouped by acquisition date | V | 55 known dates plus unknown group; exact original date/note reconciliation in SQLite/D1 and browser. |
| Total volumes, series, publisher bars, yearly acquisitions, top authors | V | Independent CSV/SQL reconciliation, dynamic counts after edits, sample exclusion and chart accessibility. |
| Add/edit modal with metadata suggestions | V | Manual and reviewed provider-assisted paths; invalid input, provider failure, stale edit handling and reload persistence. |
| CSV and full JSON export | V | Spreadsheet protection, browser download and integration roundtrips. JSON includes provenance, not R2 bytes. |
| Persistent edit/delete and backups | V | Real D1 CRUD/reopen; exact 2,124-copy restore and failed-chunk atomicity tests. |

## Delivery, operations and quality (original section 5 + Stage 5 request)

| Requirement | Status | Evidence / boundary |
| --- | --- | --- |
| Install dependencies and run normalization first | V | Prior-stage deterministic foundation retained; Stage 5 clean locked install and dedicated CSV regression run. |
| Cover fallback under failure/rate limiting | V | Provider failure fixtures, safe redirects/byte limits, R2 restart and browser broken-image fallback. |
| Full responsive UI, details, spines, timeline | V | Existing full suites retained and rerun on final build. |
| Wrangler config and production build scripts | V | Local TOML, separate hosted JSON template, staged upload wrapper compatible with installed CLI; static guards tested. |
| Migrations and local DB setup | V | Fresh Wrangler application, journal/repeat checks, schema parity and disposable tests. |
| Environment/secrets/auth documentation | V | [DEPLOYMENT.md](DEPLOYMENT.md), example vars, fail-closed JWT tests; no credentials included. |
| Deployment and rollback instructions | V | Pages-vs-Workers command distinction, independent code/data rollback and backup runbook documented against installed CLI and official docs. |
| Actual deployment, hosted Access/D1/R2 and rollback rehearsal | U | Requires account, owner/IdP, resource UUIDs, secrets, stable domains and remote access. Not run. |
| Dependency install, type checks, lint, unit/integration, build, migration/CSV checks | V | Exact commands/results in Stage 5 report; lint added during this stage. |
| E2E browse manga/CDs, series/albums, cover/spine switching | V | `library.spec.ts` on desktop/mobile. |
| E2E search/filter, gap detector, haul timeline | V | `library.spec.ts`, `insights.spec.ts` and release lookup tests. |
| E2E add/edit/delete, export/import, reload persistence | V | `management.spec.ts` plus downloaded JSON recovery in `production.spec.ts`. |
| Mobile responsiveness, accessibility, keyboard, reduced motion | V | Chromium width sweeps, axe WCAG A/AA scans, focus trap/return, Escape and reduced-motion assertions. |
| Physical mobile devices, Safari/Firefox and screen-reader evaluation | U | Layout implementation exists; those environments were not tested. |
| API throttling and caching | P | Shared D1 provider leases/backoff, response limits, cache reuse and private responses tested. No general per-owner API abuse limiter or operational cache-retention job. |
| Form and import validation, SQL safety, authorization | V | Shared Zod and DB constraints, bound SQL injection fixtures, JWT/CSRF/body-limit checks and atomic stale-edit guards. |
| Error/failure states | V | Initial DB failure, refresh retention/retry, empty data, metadata failure and form errors tested. |
| React render error boundary | U | Added and type/build checked; forced render-crash recovery not separately exercised in browser. |
| Backup integrity | V | Full table equality after restore, conflict rejection, missing chunks, transaction rollback, D1/R2 persistence. JSON UI capped at 8 MiB. |
| Complete hosted R2 backup/restore automation | N | Object-storage runbook only; no scheduled job, remote bucket copy or hosted recovery drill. |
| Performance substantially above 177 entries | V | Real D1 2,124-copy load/restore plus 5,000-copy/1,000-title browser fixture; timings and limits in report. |
| Hosted CPU/memory limits and large-collection SLA | U | Client still receives whole library; no hosted load test or pagination/virtualization. |
| Source, directory map, local commands, deploy/env/migration/seed docs, user guide | V | Delivered source and [DIRECTORY_STRUCTURE.md](DIRECTORY_STRUCTURE.md), [DEPLOYMENT.md](DEPLOYMENT.md), [USER_GUIDE.md](USER_GUIDE.md). |
| Testing report, known limitations and honest readiness assessment | V | [STAGE5.md](STAGE5.md) and [SECURITY_REVIEW.md](SECURITY_REVIEW.md). |
| Complete source ZIP | V | `release:zip` builds a verified manifest/archive with source, tests, docs, migrations and supplied CSV; excludes secrets/live state. |
| Production-ready security/deployment state | P | Local release QA passes, but unresolved dependency advisories and unverified hosted gates prevent production sign-off. |
