# Visual recognition — Phase A: barcode scanning

Status, 2026-10-24: **Phase A is implemented and verified locally** (unit, integration, real local D1, and Chromium browser tests). Phases B and C are planned in [ROADMAP.md](ROADMAP.md#visual-recognition-phases) and are **not implemented**. Real iOS/Android devices have **not** been tested; see [Limits](#limits-and-unverified-items).

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| **A. Barcode scan** | Scan option in Add; live camera barcode decoding on the device; photo and typed-ISBN fallbacks; ISBN-13/ISBN-10; collection-first lookup; Google Books + Open Library edition metadata; reconciliation with owned series, editions and volumes; duplicate warnings that never block; editable confirmation; rate limits, size limits, owner-only endpoint; measured test set | **Done** |
| B. Single-cover recognition | Photograph/upload one cover; server-side multimodal model extracts title, alternate title, volume, language, visible publisher (JP/EN/KR); collection search first, then catalogs; ranked candidates; manual correction; photos not retained without consent | Planned |
| C. Multi-volume photos and batches | One photo of several volumes; per-cover detection; editable checklist; shared acquisition date, store and notes; saves as separate copies in one acquisition batch; uncertain/unrecognized items flagged | Planned |

## How a scan works

1. **Add → Scan barcode** opens the rear camera (`facingMode: environment`, no audio). The camera starts only after this explicit choice.
2. Frames are decoded **on the device**. Android Chrome uses the native `BarcodeDetector` when it supports EAN-13. Elsewhere (iOS Safari, Firefox, desktop Linux Chromium), [`barcode-detector`](https://github.com/Sec-ant/barcode-detector) 3.2.2 runs ZXing-C++ compiled to WebAssembly (`zxing-wasm` 3.1.3). The WASM is self-hosted with the build: no third-party CDN request, lazy-loaded only when the scanner opens (≈464 kB gzip).
3. Only the band under the on-screen frame is decoded. A code is accepted after **two identical consecutive reads**, then the camera is released. Alternate frames get a contrast-stretched pass for glare and dim light.
4. The ISBN is validated (check digit, 978/979 prefix). Japanese price codes (192…), retail EANs and UPC-A codes are explained instead of looked up. ISBN-10 is converted to ISBN-13; 979 ISBNs have no ISBN-10 form.
5. `POST /api/scan/isbn` receives only `{code, source, retry}` (2 KB limit). **Images never leave the device.**
6. The server checks the collection first. A volume edition that already records this ISBN answers with **zero provider requests**.
7. Otherwise it queries Google Books (`isbn:`) and Open Library (`api/books?jscmd=details`) in parallel through the existing D1 cache (7 days; failures cached for 60 s), outbound spacing and 429/503 back-off.
8. A catalog record is used only if it **lists the scanned ISBN** (`isbnVerified`). Other results are shown as context and never applied.
9. Reconciliation ranks owned series by exact/alias title keys, then format-word stripping and containment. When no owned series is a strong match, one MangaDex title search **bridges scripts**: 薫る花は凛と咲く → *The Fragrant Flower Blooms With Dignity*. A MangaDex work is trusted only when its own titles include the scanned title.
10. The review screen shows every field with its source: *From your collection*, *From the catalog*, *Assumed from ISBN*, or *Needs your input*. It shows the ranked series choices, a picker for any owned series, and duplicate warnings. Nothing is saved until the owner presses **Add to collection** / **Add another copy**.

### Matching rules that protect the collection

- Only an exact title or alternate title (score ≥ 0.8) is preselected. A shared author cannot promote a partial title, because spin-offs share creators. Containment matches (*Fruits Basket* vs *Fruits Basket: Collector's Edition*) are offered, not chosen.
- The owned edition run is reused only in the same language and format. A JP volume 2 is never a duplicate of the EN volume 2; an omnibus volume 1 is never a duplicate of a standard volume 1; a light novel is penalized against a manga series.
- Saving reuses the run's exact identity (language basis, numbering basis, format, medium, publisher). This prevents the editor from silently splitting an edition into a second run.
- Duplicates warn and change the button to **Add another copy**; they never block. Choosing a series by hand (when no catalog knows the ISBN) re-checks duplicates live as the volume or language is corrected.

### What is stored

- `volume_editions.isbn13`: the scanned, checksum-valid ISBN, shared by every copy of that volume edition. Adding a copy never replaces a different recorded ISBN; it returns a 409 that asks the owner to change the edition name or correct the ISBN. The editor shows and edits the ISBN and accepts ISBN-10.
- `external_refs` (`match_basis='isbn'`, `is_owner_confirmed=1`): the catalog record the owner confirmed, as provenance. Provider ISBNs, dates and page counts are never copied into the collection.
- `request_limits` (migration `0002_request_limits.sql`): fixed-window counters, 30 lookups/minute and 400/hour, shared across isolates. Operational state only; excluded from JSON backups.
- CSV columns are **unchanged**. JSON backups carry ISBNs because they already export every `volume_editions` column; restore round-trips them (tested).

## Do I own this? (check mode)

A third Add mode runs the same decode and `/api/scan/isbn` lookup, then shows a read-only verdict instead of the review form (`ownershipAnswer` in `src/domain/scan.ts`, `OwnershipCheck.tsx`). It reuses the match, volume and language the add flow would preselect, so a check followed by **Add this copy** agrees with it. Adding reuses the lookup result without a second request.

- **owned:** the server found an exact-ISBN or same-volume copy, or the shelf has that volume in the matched edition run.
- **series:** the series is matched but that volume isn't owned. The card shows the owned run's volumes as ranges and the lowest whole volume missing. That number is withheld when any label isn't a whole number. It also lists the series' other owned runs.
- **new:** no series match. This verdict is called reliable only when an ISBN-verified catalog record gave a title to match. Otherwise the card says only that no copy records this ISBN.
- A top match below the 0.8 preselection threshold is labeled possible, with its reasons. It is never stated as fact.

Nothing is written. Unit tests cover each verdict, live shelf duplicates, other-language editions, weak matches and range formatting. Browser tests cover owned → next book → add hand-off (axe and no overflow on desktop and mobile) and the no-catalog case. Real devices remain untested, as for Phase A.

## Scanning a stack (Log a haul)

`BarcodeScanner` has a `continuous` mode for the haul form. The camera keeps running, and each newly confirmed ISBN (the same code on two consecutive frames) is reported once. The same code is reported again only after it has been out of the frame for 2.5 s. That lets a second copy of the same book be logged on purpose without double-counting a book held still. Each code runs the normal lookup and preselected match. A row that lacks a title or volume is highlighted for typing. A row whose volume is already owned (exact ISBN, or the shelf's matched run) says so but is still allowed.

## Test set

[`tests/fixtures/scan/isbn-cases.json`](../tests/fixtures/scan/isbn-cases.json) holds 28 ISBNs. All but two were found in Google Books or Open Library search results on 2026-10-24; the two labeled synthetic ISBNs have valid check digits and are unassigned. The set covers:

- English and Japanese editions, plus one Korean edition.
- Owned duplicates: the owner's real Chainsaw Man, Spy x Family, A Sign of Affection, Fragrant Flower, Fruits Basket CE, Your Name and Girls' Last Tour volumes.
- New volumes in owned series.
- New language editions of owned series. Two of these deliberately collide with an owned EN volume of the same number: ゆるキャン△ 11 and 스파이 패밀리 08.
- Visually similar consecutive volumes, such as チェンソーマン 2/3/5.
- Ambiguous titles: an omnibus, the *your name. Another Side* manga vs its light novel, and the *Frieren —Prelude—* novel.
- An eBook ISBN, a 979-8 ISBN, an ISBN-10 ending in X, a non-manga book and new series.
- Six invalid codes.

Expectations come from the books and the owner's CSV, not from system output. `npm run scan:record-fixtures` re-records the live responses (77) that the real lookup requests. It refuses to write fixtures if any provider failed, and never stores the Google key.

## Measured results (2026-10-24)

Barcode decoding and catalog/match accuracy are measured separately. Every number below is an actual run, not an estimate.

### ISBN lookup and reconciliation

Measured on 28 cases, replaying recorded live responses against the real seeded 177-copy collection (`tests/integration/scan.test.ts`, full rows in `data/generated/scan-isbn-accuracy.json`).

| Measure | Result |
| --- | --- |
| Catalog record found that lists the exact ISBN | **14/28** (14/26 real ISBNs) |
| Correct series preselected, or correctly none | **17/28** overall; **14/14** when a catalog record exists |
| Wrong series preselected | **0** |
| Correct volume number | 17/28 overall; **14/14** when a catalog record exists |
| Correct edition language (catalog, collection or labeled ISBN-prefix assumption) | **28/28** |
| Owned duplicates detected automatically | **5/12** |
| False duplicate warnings | **0** |
| Scanned ISBN kept unchanged in the draft | 28/28 |
| Expected caution flag shown (eBook, omnibus) | 1/2 |

**Findings:**

- **Google Books `isbn:` search returned zero results for every test ISBN** with this project's key. That includes `9781974715466`, which Google's own title search lists. Google records were recovered only through one ISBN-verified title search seeded by an Open Library title. Every Google record in this run came that way.
- **Neither catalog lists half of the real ISBNs**, mostly Yen Press and some Kodansha USA and VIZ volumes. In those cases the scan keeps the ISBN, flags every field, and asks the owner to type or pick the series. That is why only 5 of 12 owned duplicates are detected automatically. Picking the owned series in the review then detects the duplicate live (browser-tested with Girls' Last Tour vol. 6).
- The eBook-ISBN case has no catalog record, so its eBook flag could not be shown.
- Japanese and Korean editions are matched to owned English series only through the MangaDex bridge (5/5 Japanese owned-series cases with a catalog record; the Korean edition is in neither catalog). With the bridge down, no series is guessed (tested).
- Open Library timed out on 10 consecutive lookups during one recording run. Lookups degraded to manual entry as designed.

### Barcode decoding

Measured with `tests/e2e/scan-accuracy.spec.ts` (full rows in `data/generated/scan-barcode-accuracy.json`). It ran in Chromium 155 on Linux with the ZXing WebAssembly engine, the same engine iOS Safari uses. Images are **synthetic** renderings of the 28 test-set ISBNs from an independent EAN-13/EAN-5 encoder, saved as JPEG. They are not photographs of real books.

| Variant | Photo path | Live camera path (10 ISBNs) |
| --- | --- | --- |
| Clean | 28/28 | 10/10 |
| Far (1.6 px modules) | 28/28 | 10/10 |
| Tilted 8° | 28/28 | 10/10 |
| Portrait 90° | 28/28 | — |
| Upside down | 28/28 | — |
| Skewed (perspective-like shear) | 28/28 | — |
| Blur 1.5 px | 27/28 | — |
| Low contrast + heavy noise | **0/28** | **0/10** |
| Glare hotspot | 28/28 | 10/10 |
| Busy cover background | 28/28 | — |
| Japanese ISBN + 192 price code | 28/28 (ISBN chosen) | 10/10 |
| EAN-5 price add-on | 28/28 | — |
| Blur 3 px | **0/28** | — |
| **Total** | **307/364** | **50/60** |
| **Wrong ISBN read** | **0** | **0** |

Live camera median time from opening the camera to lookup: **342 ms** (slowest 588 ms), including the two-read confirmation.

The contrast-stretch second pass raised glare from 0/28 to 28/28 (photo) and 0/10 to 10/10 (camera). A 1 px denoise before stretching was also tried and **reverted**: it dropped glare back to 0/28 and tilted camera reads to 3/10. Heavy noise at low contrast and 3 px blur remain unreadable; the owner should rescan closer, with more light, or type the ISBN.

Real phone photos: **not measured**. Put photos named `<isbn>-anything.jpg` in a folder and run `STRAWBY_BARCODE_PHOTOS=/path npm run test:scan-accuracy` to measure them.

### Failure handling verified

| Case | Behavior |
| --- | --- |
| Camera permission denied, no camera, camera busy, insecure (HTTP) page, no camera API | Specific recovery message; photo and typed-ISBN fallbacks still work (browser) |
| Lookup API down | Retry, or continue with the ISBN kept and a duplicate-check warning (browser) |
| Open Library 503 and Google timeout | Manual entry; failure briefly cached; 503 back-off honored even on retry; recovery after back-off |
| Google quota (429) only | Open Library alone completes the match |
| MangaDex bridge down | Catalog data kept; no series guessed |
| No Google key | Google skipped, not attempted |
| Invalid codes | 422 before any database or provider work |
| More than 30 lookups/minute | 429 with wait time |
| Missing same-origin header, wrong content type, oversized body | 403 / 415 / 413 |
| Anonymous POST on the hosted site | 403 |

## Limits and unverified items

- **No real iOS or Android device was tested.** Chromium emulation verified the mobile layout, touch-size controls, sticky save bar and no horizontal overflow at 390 px. iOS-specific code paths are implemented but unverified on a device: inline video (`playsInline`/`muted`), releasing the camera when backgrounded, `createImageBitmap` EXIF orientation, and focus and torch constraints. The torch toggle appears only where the browser reports the capability (typically Android Chrome).
- WebKit and Firefox were not available to Playwright here.
- The camera needs HTTPS. The hosted site qualifies; a phone opening the local dev server over a LAN IP does not.
- Catalog coverage is the main accuracy limit. A Japanese bibliographic source such as openBD or NDL could be added later; neither was part of this phase.
- Store names and shared acquisition batches now come from **Log a haul** (a range of volumes, or continuous scanning of a stack). Phase C would add photo detection. Single scans record a per-copy date (defaulting to today, clearable) and notes.
