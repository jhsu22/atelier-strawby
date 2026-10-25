# Feature ideas (proposed, not scheduled)

> **Do not implement anything in this document unless the owner specifically asks for that item.** These are ideas recorded for future reference, not approved work. Reading this file, finishing a related task, or noticing that an item would be easy is not a request to build it. When the owner asks for one, treat it like any other stage: restate dependencies and acceptance criteria first, as described in [ROADMAP.md](ROADMAP.md).

Recorded 2026-10-24, after visual recognition Phase A. Nothing here is implemented. Items that already exist (released-volume gaps, the haul timeline, Discogs CSV import, ISBN scanning) are omitted. Where an idea overlaps the planned Phase B/C work in [ROADMAP.md](ROADMAP.md#visual-recognition-phases), the relationship is noted. Sizes are rough estimates.

## Now: small changes with big payoff, built on existing pieces

### 1. "Do I own this?" mode for bookstores

> **Implemented 2026-10-24** at the owner's request, as an owner-only third mode in Add. See [SCANNING.md](SCANNING.md#do-i-own-this-check-mode) and [DECISIONS.md](DECISIONS.md#do-i-own-this-decisions-2026-10-24). It needs a connection; offline checking would come with #2.

The most common question in a shop is "do I already have vol 5?" Phase A already does a collection-first lookup. Add a scan mode that only checks and saves nothing. It answers right away, for example "You own vols 1–4 (EN). Vol 5 is the next one." It also flags duplicates before a purchase.

- **Builds on:** `src/server/scan/lookup.ts`, `src/server/scan/reconcile.ts`.
- **Size:** small.

### 2. Installable app with an offline shelf

> **Implemented 2026-10-24** at the owner's request: `public/sw.js`, two manifests, app icons, an offline banner, and offline "do I own this?" by recorded ISBN. See the [user guide](USER_GUIDE.md) and [DECISIONS.md](DECISIONS.md#offline-shelf-and-haul-decisions-2026-10-24).

The app is built for phones, but it has no web manifest or service worker, and bookstores often have bad signal. Make it installable to the home screen. Cache the last library snapshot so browsing and "do I own this" by typed ISBN or title still work offline.

- **Builds on:** `collection_state.revision` for cache invalidation.
- **Size:** small to medium.

### 3. Private notes on the public shelf

> **Implemented 2026-10-24** at the owner's request. See [PUBLIC_ACCESS.md](PUBLIC_ACCESS.md#private-notes) and [DECISIONS.md](DECISIONS.md#private-notes-decisions-2026-10-24). Existing notes became private, and derived memory tags are hidden with the note.

Before this, every copy's note was shown to anonymous viewers in `src/components/details/EntryDetails.tsx` (the copy list and the "Acquisition & notes" section), including notes like "from sammy <3". Add a per-copy "private note" setting, with private as the default for new notes, and hide those notes on `/`.

- **Needs:** one additive migration.
- **Size:** small. Recommended first: it closes a privacy gap more than it adds a feature.

### 4. Log several copies at once (haul entry)

> **Implemented 2026-10-24** at the owner's request as **Log a haul**: migration `0004_acquisition_batches`, `POST /api/hauls`, ranges, stack scanning, a private-by-default store, and timeline and stats grouping. See [DATA_MODEL.md](DATA_MODEL.md#logged-hauls). Photo detection is still Phase C.

Phase C bundles acquisition batches (date, store, notes) with shelf-photo recognition, but the batch part doesn't need recognition. Ship the batch schema and a "Log a haul" form on its own:

- Pick a series, enter a range like "vols 4–8", and set the date, store and note once.
- Add continuous barcode scanning: scan a stack and get a checklist.

This also gives the timeline real hauls instead of "same date, maybe separate trips."

- **Builds on:** the Phase A scanner and review screen.
- **Size:** medium. Phase C's photo step then becomes an extra input to this same form.

## Next: deeper collection features

### 5. Wishlist and gift list

The released-volumes panel already knows what's missing. Let the owner mark missing volumes or new series as wanted. Show a public "Wishlist" page, since gifts are a big part of this collection. When a wanted volume is scanned or added, cross it off automatically.

- **Size:** medium.

### 6. Upcoming releases

`src/domain/releases.ts` currently excludes future-dated listings. Keep them and show "Coming soon for series you collect" as a short list or calendar, with wishlist shortcuts.

- **Note:** automatic refresh needs a small scheduled Worker, because Pages has no cron. Until then, refresh on demand.
- **Size:** medium. Pairs naturally with #5 (shared release data).

### 7. Reading status and the to-read pile

Track per copy whether it's unread, reading or read, and optionally a rating or short review per series. Add a "read up to vol N" series badge, a filter for the to-read pile, and a backlog stat.

- **Needs:** an additive migration.
- **Size:** medium.

### 8. Data clean-up queue

> **Implemented 2026-10-24** at the owner's request: migration `0006_cleanup_queue`, `POST /api/cleanup` and `POST /api/cleanup/covers`, and an owner-only **Clean up data** panel linked from the shelf and the stats caveats. At the owner's choice, "I don't know" dates and "no cover exists" are remembered, and volumes with no cover get a fifth queue. See [DATA_MODEL.md](DATA_MODEL.md#data-clean-up-queue) and the [user guide](USER_GUIDE.md#clean-up-data).

The stats page keeps hedging: assumed languages, unconfirmed numbering, missing dates, representative-only covers. Add an owner-only queue that walks through these one at a time with one-tap confirm or fix. Each fix makes the stats more trustworthy and lets those caveats shrink.

- **Builds on:** the counts already computed in `src/domain/collection-insights.ts`.
- **Size:** small to medium.

### 9. Barcode scanning for CDs

Scanning only handles ISBNs. Extend it to EAN/UPC, look up the barcode in MusicBrainz, and fill in tracklists and catalog numbers automatically. Most CD fields are typed by hand today.

- **Size:** medium.

## Later: bigger bets

### 10. Year in review and "on this day"

Show an "On this day" memory on the shelf, plus a shareable yearly recap: hauls, top series, favourite store, notes. It fits the "stories behind it" pitch.

### 11. Spending and stores

Optional price, currency and store per copy or per haul, with spend by year and by store.

- **Depends on:** #4.

### 12. Custom shelves and lending

Owner-defined lists (favourites, signed copies, gift-from-X) on top of the existing manual tags. A lending log (who borrowed it and when) with an "out on loan" badge.

### 13. Japanese catalog source (openBD or NDL)

[SCANNING.md](SCANNING.md) names catalog coverage as the main accuracy limit for JP editions. This would improve scanning, Phase B, and released-volume lookups.

### 14. Phase B and C cover recognition, as already planned

See [ROADMAP.md](ROADMAP.md#visual-recognition-phases). This becomes much cheaper once #4 exists, because recognition just fills in the haul form. It is also the only item that brings ongoing model costs and a photo-retention policy.

## Not recommended for now

- **Multi-user or friends' libraries.** [DATA_MODEL.md](DATA_MODEL.md) rules out tenancy, and it would cost a lot for one person's collection.
- **Server-side pagination and virtualization.** Only worth doing if the collection grows a lot (see limit 7 in [STAGE5.md](STAGE5.md#required-manual-work-and-limitations)).

## Suggested order, if and when requested

**#3, #1, #2 and #4 (done)**, then **#5 and #6** together, then **#8 (done)**, then the rest.

Separately, a few release gates that aren't features remain open: hosted acceptance checks, testing on real iOS and Android devices (#1 and #4 depend on the camera), and the dependency advisories. See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md).
