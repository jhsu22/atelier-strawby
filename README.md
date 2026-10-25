# Atelier Strawby

**Your collection, and the stories behind it.**

Atelier Strawby is a personal library for manga, light novels, books, and CDs. Its collection view, **Strawby Stacks**, brings your shelves together with cover art, edition details, acquisition dates, and the memories attached to each physical copy.

[Visit Strawby Stacks](https://atelier-strawby.pages.dev/) · [User guide](docs/USER_GUIDE.md) · [Local setup & deployment](docs/DEPLOYMENT.md)

## A home for your shelves

- **Browse visually.** Switch between cover grids and book spines, open copy details, and enjoy light and dark themes on desktop or mobile.
- **Find the right copy.** Search titles, creators, publishers, and personal notes. Combine filters for media, language, year, edition, and memory tags. Share a URL with your current shelf view.
- **See what’s missing.** Compare owned volumes within an edition and explore released-volume catalogs with source and coverage notes.
- **Remember every haul.** Log a shopping trip in one go (a range of volumes, or a scanned stack) with its date, store and note. Revisit purchases and gifts in the haul timeline.
- **Check before you buy.** Scan a book in the store to see whether you already own it, which volumes you have, and which one is next.
- **Take it with you.** Install the shelf on your phone. It keeps working offline with the collection saved on the device.
- **Watch your collection grow.** Explore collection totals, distributions, yearly acquisitions, and personal insights.
- **Keep it yours.** Add and edit physical copies, review optional metadata suggestions, set your own artwork, and move your data with CSV imports, CSV exports, and full JSON backups.

The shared shelf is read-only, and notes stay private unless you choose to share them. Collection management lives at [`/edit`](https://atelier-strawby.pages.dev/edit), protected by owner-only Cloudflare Access. Write APIs, imports, and backups also verify the owner’s identity. [Access configuration](docs/PUBLIC_ACCESS.md).

## Built with

| Layer | Technology |
| --- | --- |
| Application | Astro 5, React 19, TypeScript |
| Styling | Tailwind CSS 4 and custom CSS |
| Hosting | Cloudflare Pages |
| Data | Cloudflare D1 with Drizzle ORM |
| Artwork | Private Cloudflare R2 storage, served through the app |
| Owner sign-in | Cloudflare Access |
| Verification | Node test runner, Playwright, axe |

Optional metadata comes from MangaDex, Google Books, Open Library, MusicBrainz, and Cover Art Archive, with a labeled digital iTunes fallback. Suggestions are reviewed before saving; manual entry remains available when a provider is unavailable.

## Run locally

Use **Node.js 22.18+** and npm. From a fresh checkout:

```bash
git clone https://github.com/jhsu22/atelier-strawby.git
cd atelier-strawby
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run seed:local
npm run dev
```

Open **http://127.0.0.1:4321**. The example environment enables editing only on localhost. Preserve an existing `.dev.vars` and `.wrangler` directory when returning to an established checkout.

The included CSV seeds 177 manga copies across 38 series. Repeating the same import preserves owner edits and does not add duplicate copies.

Local development uses emulated D1 and R2. Local state and the hosted collection are independent. An optional Google Books key belongs in `.dev.vars`; see the [Google Books setup guide](docs/GOOGLE_BOOKS.md).

## Check your changes

```bash
npm run validate        # Lint, type checks, unit/integration tests, schema, build
npm run test:d1         # Tests against the local Cloudflare runtime
npm run test:e2e        # Desktop/mobile browser and accessibility checks
```

`npm run release:verify` runs the complete release checks, including migration verification. Browser tests create disposable seeded D1/R2 state. They use system Chromium when available; otherwise install it with `npx playwright install chromium`. Use `STRAWBY_TEST_PORT=4337` if the development server already occupies port 4321.

For anonymous shelf and access-denial checks:

```bash
STRAWBY_TEST_READ_ONLY=true STRAWBY_TEST_PORT=4337 npx playwright test public-access.spec.ts
```

## Deploy your own

The app runs on Cloudflare Pages with separate production and preview D1 databases and private R2 buckets. The checked-in `wrangler.toml` points to this installation; configure your own bindings, canonical origins, owner identity, and Access policy before deploying a fork. Keep credentials in Cloudflare secrets or ignored local environment files.

Follow the [deployment guide](docs/DEPLOYMENT.md) for provisioning, migrations, publishing, backups, and rollback, and the [public viewing and owner editing guide](docs/PUBLIC_ACCESS.md) for the `/edit` Access policy. JSON backups contain artwork references; R2 image bytes need a separate backup.

## Explore the project

| Guide | What you’ll find |
| --- | --- |
| [User guide](docs/USER_GUIDE.md) | Browsing, editing, imports, and backups |
| [Deployment](docs/DEPLOYMENT.md) | Local setup and Cloudflare operations |
| [Public access](docs/PUBLIC_ACCESS.md) | Shared shelves and owner-only management |
| [Released volumes](docs/RELEASED_VOLUMES.md) | Edition matching, missing volumes, and catalog limits |
| [Barcode scanning](docs/SCANNING.md) | Scanning manga ISBNs, matching, measured accuracy, and the recognition roadmap |
| [Architecture](docs/ARCHITECTURE.md) | Application structure and service boundaries |
| [Data model](docs/DATA_MODEL.md) | Catalog entries, editions, and owned copies |
| [Directory structure](docs/DIRECTORY_STRUCTURE.md) | Where code, tests, and assets live |
| [Testing](docs/TESTING.md) | Verification procedures and recorded results |
| [Security review](docs/SECURITY_REVIEW.md) | Recorded findings and operational considerations |

Stage reports in `docs/` preserve development history and the verification results recorded at each stage.
