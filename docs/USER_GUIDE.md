# Using Atelier Strawby

1. **Browse:** choose All Media, Manga, Books or CDs. Use the grid button for covers or the shelf button for individual spines. Sample CDs are labeled and excluded from personal totals. Light novels remain in Manga with an LN badge.
2. **Find something:** type a title, alternate title, author/artist, publisher/label or memory into Search. Combine language, publisher, year, format and memory filters. Clear filters to return to everything. Shelf state and open details survive reload through the URL.
3. **Open details:** select a card/spine. Manga details show individual physical copies, dates, edition/language and original notes (public notes only on the shared shelf); albums show the jewel case and available release/track data. Missing metadata stays visibly unknown. Escape closes the panel and returns keyboard focus. On a phone, the panel is a bottom sheet.
4. **Find gaps:** enable the gap detector in series details. It compares printed numbering within each language/edition, retaining duplicates and keeping ambiguous omnibus numbering separate. Internal gaps are not a claim that the whole series is complete. The optional Released & missing lookup searches an external catalog; check its edition, source and coverage warnings.
5. **Remember a haul:** open Haul Timeline. Filter by date/year, media, title or memory; unknown dates have their own group. Select an acquisition to open its details. Stats shows live personal-copy totals and distributions; read its counting rules for uncertain language/edition metadata.
6. **Add or edit:** use Add, select the media type, enter the title and your copy's details, then save. Metadata lookup offers candidates to review against the physical copy. It never supplies a purchase date or personal memory. Manual entry still works when providers fail. To edit/delete, open a copy in details. Delete requires confirmation. If another tab saved first, keep your draft and reload the latest version before editing again.
7. **Import:** open Import & export, select Manga/Books CSV, CD CSV, Discogs CSV or Full JSON backup, choose the file and Validate & preview. Correct invalid rows, decide whether duplicate candidates represent additional physical copies, and confirm. Existing Copy IDs always skip. Interrupted CSV imports can resume with their original duplicate choice. Discogs Date Added only becomes the acquisition date if you choose that mapping.
8. **Keep notes private:** every note is private unless you choose otherwise. In the editor or scan review, **Keep this note private** is checked by default. A private note is hidden on the public shelf, along with the memory tags derived from it (such as *Gifts from Sammy*). Edition tags (Box Set, Omnibus, Collector's Edition) and tags you typed yourself stay visible. Visitors also can't search private note text. In `/edit`, private notes show a small **Private** label. To share a note, uncheck the box and save. Notes that existed before this feature started out private.
9. **Back up:** download Full JSON backup for exact IDs, tracks, tags, notes and their privacy, provenance and sample flags. JSON backups made before private notes restore with every note private. CSV export and import don't carry note privacy; imported notes start private. CSV is for exchange and spreadsheet use, with formula-cell protection. JSON restore skips identical rows and refuses conflicting identities; restore a conflicting old snapshot into a separate empty database. Cached R2 image bytes need their own operator backup. UI limits: CSV 900 KB and 1,000 records; JSON 8 MiB and 20,000 rows per table. Larger collections use D1 SQL backup/restore. Never split a JSON backup by hand.

**Install it and use it offline.** In your phone's browser, use *Add to Home Screen* (Safari) or *Install app* (Chrome). Installing from `/edit` opens the editing shelf, and installing from `/` opens the shared one. After you've opened the shelf once with a connection, it also works offline. You'll see the shelf as last saved on that device, with search, filters, details, the timeline and stats. A banner shows when you're offline and how old the saved shelf is. **Do I own this?** still answers by ISBN for copies that have one recorded (scanned or typed). Copies without an ISBN can only be found by searching the title. Adding, editing and catalog lookups need a connection, and nothing is saved while you're offline. When the connection returns, the shelf refreshes.

The theme button switches light/dark mode and saves the preference on your device. Reduced-motion preferences are respected. If artwork fails, a typographic cover remains. If refresh fails, the current shelf stays visible with retry; if initial loading fails, use the retry link after checking setup. No cloud sync exists between your local emulator and a hosted instance: each uses its configured D1 database.

Local setup and owner authentication: [DEPLOYMENT.md](DEPLOYMENT.md). Current verification and limitations: [STAGE5.md](STAGE5.md).

## Scan a barcode

On the editing page, choose **Add**, then **Scan barcode**. Allow the camera and hold the book's barcode inside the frame; on Japanese books scan the upper barcode (978…), not the 192 price code. The app reads the barcode on your device and looks up only the ISBN.

The review screen shows where each detail came from. Check anything marked **Needs your input** or **Assumed from ISBN**, choose the right series (or **A series I own** when the catalogs don't know the book), and press **Add to collection**. If you already own that volume, you'll see a note and the button reads **Add another copy**: duplicates are always allowed. After saving, **Scan next book** keeps going.

### Log a haul

For a shopping trip or a stack of gifts, choose **Add**, then **Log a haul**. Set the date, store and a note once; they apply to every copy. **Keep the note and store private** is checked by default. Then add copies in either of two ways:

- **Add volumes:** pick a series you own (and its edition, if you have more than one), or *A new series…*, and enter a range such as 4 to 8.
- **Scan a stack of books:** the camera stays on. Hold each barcode until it's added, then move to the next book. To log a second copy of the same book, take it away and scan it again.

Volumes already on your shelf are marked but can still be saved, since duplicates are allowed. Remove any row with ×. **Save as one haul** saves everything or nothing, up to 20 copies at a time. For a bigger haul, save the first 20 and keep adding: later saves join the same haul. On the timeline, a logged haul gets its own card with the store, even when other copies share its date. To take a copy out of a haul, open it in the editor and uncheck **Part of the haul**.

### Do I own this?

In a bookstore, choose **Add**, then **Do I own this?** and scan the book. Nothing is saved. You'll see one of three answers:

- **Yes, you own this.** The copies on your shelf and when you got them.
- **Not this one, but you collect it.** Which volumes you own of that edition (for example *vols. 1–4, 7*), the lowest one you're missing, and any other editions you own.
- **Not in your collection.** If no catalog recognizes the ISBN, the app says so instead of guessing, because it can only check copies with that ISBN recorded.

A weak series match says "possibly" and asks you to compare the cover. **Check another** scans the next book. **Add this copy** goes to the normal review screen using the same lookup, so it doesn't run a second time. **Open series** shows the series on your shelf. Checking uses the same owner-only lookup as scanning, so it needs a connection and counts toward the per-minute lookup limit.

If the camera is blocked or unavailable, use **Use a photo** or **Type an ISBN** (ISBN-10 works too). Photos are read on your device and never uploaded. **Edit all fields** opens the full editor with the scan's details, including the ISBN. More: [SCANNING.md](SCANNING.md).

