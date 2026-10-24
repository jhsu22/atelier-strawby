# Cloudflare Pages deployment and operations

**Status: configuration and local workerd validation only. No Cloudflare account, hosted DB/bucket, Access application or deployment was created or verified during Stage 5. Resolve the release blockers in [STAGE5.md](STAGE5.md) before production use.**

## Supported toolchain

Use the lockfile: Astro 5.18.2, `@astrojs/cloudflare` 12.6.13, Wrangler 4.151.3. `npm run build` emits a Pages advanced-mode `_worker.js` directory and static assets in `dist`. New adapter majors change the deployment target; do not upgrade the platform blindly. [Astro 5 adapter documentation](https://v5.docs.astro.build/en/guides/integrations-guide/cloudflare/).

Wrangler 4.151.3 **rejects `--config` on `pages deploy`** and selects preview/production with `--branch`, not `--env`. The release wrapper stages `dist`, migrations, a minimal private `package.json` and a standard `wrangler.json` in ignored `releases/cloudflare/`, then invokes Pages from that working directory. The package boundary also keeps Wrangler Pages temporary files from resolving the parent localhost configuration. D1 commands do accept `--config` and `--env`. The committed `wrangler.toml` is the hosted config for Pages Git builds. Preview overrides explicitly repeat both resource bindings and all runtime vars. [Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

Node 22.18+ is required for TypeScript scripts and `node:sqlite`; Stage 5 ran on Node 26.11.1. A compatible Node 22 runtime still needs its own verification. Python 3 is needed only for `release:zip`. Browser tests need Chromium (`npx playwright install chromium`, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`).

## Local setup

From a fresh source checkout:

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run seed:local
npm run seed:sample-cds
npm run verify:seed
npm run dev
```

Open `http://127.0.0.1:4321`. Preserve an existing `.dev.vars` and existing `.wrangler` data. The seed is idempotent but refuses changed source bytes/mapping conflicts; it does not reset owner edits. `verify:seed` asserts the untouched 177-copy baseline and can intentionally fail after edits. Use `npm run verify:insights` for the current collection.

```bash
npm run build
npm run preview:pages -- --port 8788
```

Local D1/R2 live under `.wrangler/state`. The SQLite diagnostic is a separate disposable verification database, never an automatic substitute for D1. `npm run test:migrations` and browser tests create their own temporary state. Do not run mutating browser tests against an owner database via `STRAWBY_TEST_URL`.

## Variables, secrets and bindings

| Name | Local | Hosted |
| --- | --- | --- |
| `DB` | `preview_database_id` in `wrangler.toml` | Distinct preview and production D1 UUIDs |
| `COVERS` | Local emulated private R2 | Distinct private buckets; leave public access disabled |
| `APP_ENV` | `local` in `.dev.vars` | `preview` or `production` in hosted config |
| `LOCAL_DEV_AUTH` | `true`, accepted only for loopback hostnames | **Unset** |
| `APP_ORIGIN` | Not needed | Exact HTTPS origin, no trailing slash/path; one allowed host per environment |
| `ACCESS_TEAM_DOMAIN` | Not needed | `<team>.cloudflareaccess.com`, no scheme |
| `ACCESS_AUDIENCE` | Not needed | Correct Access application AUD for that environment |
| `ACCESS_OWNER_EMAIL` | Not needed | Required runtime secret: the single allowed owner's email |
| `METADATA_CONTACT` | Optional public contact URL/email | Public operator contact for MusicBrainz User-Agent |
| `GOOGLE_BOOKS_API_KEY` | Optional server secret in `.dev.vars` | Optional encrypted runtime secret; restrict to Books API; see [GOOGLE_BOOKS.md](GOOGLE_BOOKS.md) |
| `CLOUDFLARE_ACCOUNT_ID` | Not needed for local work | Deployment-machine/CI account selection, not a browser variable |
| `CLOUDFLARE_API_TOKEN` | Not needed for local work | CI secret for deployment/resource operations, or use interactive `wrangler login` |

No `PUBLIC_` secrets. Never commit `.dev.vars`, `.env`, credentials, database exports or populated hosted config. Deploy only `dist`, never the repository root. The source ZIP excludes live state, generated reports, populated hosted config and all credentials. Static fonts, scripts, icons and templates are public; all collection routes and artwork API routes pass through authentication. The app does not use Astro sessions: adapter 12 announces a default SESSION KV driver, but there are no `Astro.session` calls and no session KV is required by this app. Revisit bindings if session usage is introduced.

## Provisioning (manual account access required)

Use your own account and choose project/resource names. These commands **create remote resources**; they were not run for this audit.

```bash
npx wrangler login
npx wrangler pages project create atelier-strawby --production-branch main
npx wrangler d1 create atelier-strawby-production
npx wrangler d1 create atelier-strawby-preview
npx wrangler r2 bucket create atelier-strawby-production-covers
npx wrangler r2 bucket create atelier-strawby-preview-covers
cp wrangler.hosted.json.example wrangler.hosted.json
```

Fill both environments in `wrangler.hosted.json` with returned D1 UUIDs and bucket names. Set `name` to the Pages project created above. `main` must be its production branch and `preview` must be a nonproduction branch. Choose a stable preview branch URL (`https://preview.<project>.pages.dev`) and a production hostname. Exact-origin validation deliberately rejects the generated per-deployment URLs and other aliases. A production custom domain may require an initial deployment for DNS setup; leave auth unconfigured/fail-closed until the domain and Access policy are ready.

In Cloudflare Zero Trust, create self-hosted Access applications covering the entire production and preview hosts, including `/api/*`, with an Allow policy for only the owner email. Configure an identity provider or email one-time PIN. No Bypass/Everyone policy. Protect the preview hostname with Access as well as the production custom domain; test direct `pages.dev` and deployment aliases. The app independently validates signed RS256 Access JWTs, issuer, AUD, expiry, required identity claims, owner email and the exact origin. A raw `Cf-Access-Authenticated-User-Email` header is insufficient.

In Pages → Settings → Variables and Secrets, add encrypted `ACCESS_OWNER_EMAIL` (required) and `GOOGLE_BOOKS_API_KEY` (optional) separately for production and preview. Redeploy after changing runtime variables/secrets. Use the dashboard for this environment selection; do not paste secrets into the checked-in config or shell command arguments.

## Migrate and seed

Review the static configuration, then apply migrations separately:

```bash
npm run deploy:check
npm run db:migrate:preview
npm run db:migrate:production
```

Migrations are additive `drizzle/0000_foundation.sql` and `0001_edition_medium.sql`; Wrangler records them in `d1_migrations`. Do not edit applied files. `npm run db:generate` creates future migrations; review generated SQL, run `test:schema` and test migration from the prior production version before release. The local and hosted D1 commands use the same migration directory. [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).

There is intentionally no automatic remote seed in the release command. For a new empty hosted collection, use the authenticated UI to import `initial_collection.csv` as Manga CSV and review its preview (177 rows). Alternatively import a full JSON backup from the desired local collection to preserve exact copy IDs, provenance, medium corrections and sample flags. JSON restore is additive: identical rows skip, conflicting identities block. Restore an earlier conflicting snapshot into a new empty migrated database, not over edited records. Sample CDs are optional; obtain them in a disposable local collection before exporting if desired. The local background cover utility does not enrich remote D1; hosted editor enrichment is available but needs a hosted acceptance test.

## Build, upload and acceptance

```bash
npm run release:verify
npm run deploy:prepare
npm run deploy:preview
# Complete hosted acceptance, then:
npm run deploy:production
```

`deploy:prepare` builds and stages without network deployment. The upload commands rebuild and stage; they never migrate, seed or change Access policy automatically. For Pages Git builds, the committed `wrangler.toml` supplies bindings and vars; keep it in sync with `wrangler.hosted.json`. Git builds do not run migrations.

Hosted acceptance must verify: signed-in owner browsing and CRUD with reload; unauthenticated and wrong-user denial; forged JWT and direct-origin denial; same-origin mutation protection; private/no-store headers; preview/production isolation; R2 artwork; provider network/quotas; JSON export and restore to a separate preview database; narrow/mobile keyboard flows; response latency and CPU/memory limits. Inspect Pages logs for unexpected 5xx without logging JWTs, API keys or personal backup bodies.

## Backup and rollback

Before a release, save a JSON backup from the app and a D1 SQL export/bookmark outside the repo/public directory:

```bash
npx wrangler d1 export DB --remote --config wrangler.hosted.json --output /secure/backups/strawby-before-release.sql
npx wrangler d1 time-travel info DB --config wrangler.hosted.json
```

Use the operator's actual private backup directory. Record deployment ID, schema migration list, backup checksum and Time Travel bookmark together. For R2, use an authenticated S3-compatible client or `wrangler r2 object get` to copy each `cover_variants.object_key`, retain object metadata and SHA-256 digests, and test restoring to the preview bucket. JSON contains artwork references, **not image bytes**. Large atomic restores must fit the account’s D1 per-invocation query/CPU limits; local workerd tests do not prove a free-plan quota budget. No automated full-bucket backup job is installed.

For code rollback, select a previously successful production deployment in the **Pages dashboard → Deployments → Rollback**. Do not use the Workers-only `wrangler rollback` command for Pages. Pages rollback changes code/assets, not D1 data. Preview releases can be replaced by redeploying the known-good source. [Pages rollback documentation](https://developers.cloudflare.com/pages/configuration/rollbacks/).

For a database incident, first restrict Access to prevent writes and export the current state for recovery. Prefer restoring a SQL export to a **new** D1 database (`wrangler d1 execute <new-database-name> --remote --file <backup.sql>`), then check tables, foreign keys, copy counts, notes and artwork references before rebinding. Do not reapply initial migrations over an exported database containing its schema/journal. Alternatively use `wrangler d1 time-travel restore DB --config wrangler.hosted.json --bookmark <recorded-bookmark>` after confirming the data-loss window; later writes will be lost. Retention depends on account plan. Pair the restored schema with compatible application code, restore required R2 objects, and rerun hosted acceptance. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
