# Stage 4: haul diary, analytics and collection insights

Open **Haul timeline** or **Collection stats** from desktop or mobile navigation. Direct links are `/?section=timeline` and `/?section=stats`. Both use the same live, normalized D1 library read as the shelf. Refreshing the collection or completing an edit/import refreshes their source data. No generated statistics or source replacements are used.

The timeline places newest dates first, then a separate **Memories without a date** section. It combines manga, light novels, books and personal CDs on the exact recorded calendar day. Year, media and memory filters intersect on each individual copy; the visible count is the count of matching copies, not the unfiltered haul size. Notes retain their original wording and line breaks. Repeated notes appear once per date with the number and titles of the copies carrying that note. A note spanning dates appears on each recorded date. Generic card headings never turn inferred occasions into facts.

Each date includes up to four representative covers selected from its matching titles, with existing attribution and representative-art labeling in details. Missing or failed images use the established typographic covers. The full item list keeps duplicate volumes visible. Cover and item controls open the series/album detail drawer; Escape/close returns to the diary or stats. Browser history and reload preserve the selected section and detail. Timeline filters survive opening/closing details during a session; reloading resets those filters. Shelf filters do not change collection-wide analytics or the diary's separate filters.

The series detail drawer now also has a **Released & missing volumes** panel. It compares individually dated external catalog listings with current edition ownership, separately from observed internal gaps. See [released-volume lookup](RELEASED_VOLUMES.md) for pagination, edition matching and catalog limitations.

## Counting rules

| Metric | Rule |
| --- | --- |
| Physical manga volumes | One committed, visible, non-sample owned manga record per copy, including `light_novel` editions. Books are separate. Duplicate copies and alternate languages/editions each count. This is a record-based physical total where packaging is unconfirmed. |
| Unique manga series | One canonical series ID with at least one visible personal manga/light-novel copy; languages, editions and duplicates do not add series. Book-only entries do not count. |
| CDs | One non-sample owned CD release copy. Two owned copies count twice; a multi-disc release still counts once per owned release copy. No number of discs is invented for incomplete metadata. |
| Books / light novels | Books have a separate physical-record count. Light novels are a subset of the manga count, matching established shelf behavior. |
| Language | One recorded edition language per manga/light-novel copy; assumed languages are included and their count is disclosed. Languages are not deduplicated across editions. |
| Publisher | One recorded edition publisher per manga/light-novel copy; unknown values retain an explicit bucket. The most-common-publisher insight compares known recorded publishers and reports ties. Regional publisher metadata is not silently corrected. |
| Manga / CD acquisitions by year | Currently owned personal copies in each medium by the acquisition calendar year; never the release year. Unknown dates have a separate bucket. Only recorded years appear; zero-record years are omitted. Light novels are included with manga. |
| Top authors | Each distinct recorded series-credit display name receives that series' full owned manga/light-novel copy count. Multiple credited names overlap, so this distribution need not sum to physical copies. Collective credits remain intact; names are not split or guessed. Top 10 shown, with alphabetical tie order. |
| Most collected series | Manga/light-novel physical copies grouped by canonical series across editions/languages. Duplicates count. Top 10 shown, alphabetical ties; the insight includes all tied leaders. |
| Largest individual hauls | All personal media grouped by exact acquisition date, excluding undated records and samples. Top five dates by copy count, newest date first on ties. One date can include separate purchases; it is not evidence of one shopping trip. The largest-date insight discloses a tie if present. |
| Growth insight | The difference in currently owned manga/light-novel acquisitions between the two latest recorded years. May be partial years or nonadjacent years; undated records are excluded. This is not historical inventory or a forecast. |
| Longest observed gaps | Internal unowned positive integer labels within compatible groups, ranked by number of intervening integers. Top five ranges shown. This is not a claim about published releases or series completion. |

Omnibus records are never expanded or collapsed from guessed content ranges. A confirmed single physical omnibus record counts once. The original three Steins;Gate records remain three ownership records with `source_record` numbering and unknown packaging, pending owner review. Analytics disclose uncertain numbering/format counts, and the detector withholds gaps for these sequences.

All counts follow the existing library visibility rules: staged/incomplete imports, sample manga, and orphaned catalog records are excluded. Sample CDs remain browseable on the shelf but are excluded from the diary and personal analytics. Deleting a physical record removes it from these views; no purchase-history archive is synthesized.

## Gap detector

`seriesGaps` groups by edition-run ID, edition title, language, publisher, physical format, medium and known special-edition markers. It defensively splits inconsistent metadata even if an input accidentally reuses one run ID. Separate languages, collector editions, and manga/light-novel sequences cannot fill each other's holes. Box-set acquisition tags do not split an otherwise compatible sequence of individually numbered volumes.

A comparable sequence requires a known edition identity, language, publisher and supported format, plus positive safe integer labels and `printed` numbering. Duplicate numeric labels (including leading zeros) are deduplicated only for gap comparison, never for physical totals. Source-record/unknown numbering, specials, decimal/range labels, unsafe integers, unknown formats, and incomplete edition metadata yield a reason rather than claimed gaps. Ambiguous omnibus notes/tags on another format also withhold calculation. An explicitly recorded `omnibus` format with printed integer labels compares the package numbers, never the contained standard-volume numbers.

The detector compares adjacent owned integers and emits compact inclusive ranges. It never scans up to a huge label, infers earlier/future volumes, or fetches release completeness from an external catalog. Unverified printed labels and assumed languages remain limitations even when an observable internal gap is reported.

## Verification

Verified locally on 2026-10-24:

| Check | Result |
| --- | --- |
| Astro / TypeScript | 0 errors, 0 warnings; one pre-existing hint. |
| Unit tests | 65 passed, including exhaustive checks of all 255 nonempty subsets of an eight-number sequence. |
| SQLite integration | 33 passed. |
| Real workerd D1 / R2 | 6 passed, including the shared Stage 4 reconciliation and mutation scenario. |
| Chromium desktop / mobile | All 42 scenarios passed: 40 in the full regression run; the two timeline scenarios passed on targeted rerun after correcting the test's expected gift-tag count to the eight actual source records. |
| Build | Production Pages build passed as part of browser provisioning. |
| Current local D1 | `npm run verify:insights` passed without reseeding or modifying owner records. |
| Visual / accessibility | Narrow light/dark and desktop screenshots reviewed; both panels passed axe scans in both themes and horizontal overflow checks across the listed viewport sizes. |


- `npm run verify:insights` performs read-only comparisons against the owner's **current local D1**, without reseeding. It compares totals, languages, publishers, acquisition years and every date grouping with independent SQL aggregations.
- Unit tests cover same-date mixed media, unknown dates, intersecting filters, samples, multiple credits, light novels/books, duplicate/alternate copies, compact extreme-number gaps, special and omnibus numbering, inconsistent group metadata, and date formatting without timezone shifts.
- The shared SQLite and real workerd D1 scenario reconciles every timeline group against calendar cells parsed directly from the original CSV, and every source copy's date/note against its provenance. It compares analytics with independent SQL totals/distributions/rankings. Personal CD add/delete checks verify that multi-disc releases count once and mix correctly with manga dates.
- Chromium desktop/mobile tests cover the real built Pages worker, filters, preserved original first-bookstore and gift notes, unknown-date state, series/album navigation, history/reload, all analytics, gap insights, and a test-only personal CD persisted in disposable D1. No owner collection records are modified by those tests.
- Responsive checks cover 320, 390, 650, 768, 1024 and 1440 px. Axe scans cover both panels in light/dark themes. Screenshots remain private under `data/generated/stage4-*`.

The untouched CSV test baseline has **177 manga records, 38 canonical series, 172 dated records, 55 exact dates, five undated records, EN 167 / JP 9 / KR 1, and zero personal CDs** (four excluded sample CDs). Recorded manga acquisitions are 2021: 21, 2022: 96, 2023: 26, 2024: 29, unknown: 5. Largest recorded date: **2022-12-25, 19 copies**. Kodansha has 76 records; Shikimori has the most owned series copies (15). These values are verification evidence, not application constants.

The current owner-edited local D1 was independently checked on 2026-10-24: **177 manga/LN copies, 38 series, nine light novels within that total, one personal CD, one book, no samples, EN 164 / JP 12 / KR 1, six undated personal records and 56 acquisition dates across media**. These legitimate changes are preserved; the baseline seed verifier is intentionally stricter than this current-state analytics check.

Remaining limitations: no acquisition time/store/order identity for separating same-day purchases; unknown dates cannot be positioned chronologically; physical packaging and assumed edition metadata need owner confirmation. All visible records are processed in memory using the existing library payload, so very large libraries may eventually need server pagination/aggregation. Browser verification uses Chromium emulation, not physical devices, Safari or Firefox. Hosted deployment is outside this stage.
