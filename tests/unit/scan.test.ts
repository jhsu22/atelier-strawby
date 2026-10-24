import test from "node:test";
import assert from "node:assert/strict";
import {
  formatIsbn,
  isbn10To13,
  isbn13To10,
  isbnLanguageHint,
  parseIsbn,
  validIsbn10,
  validIsbn13,
} from "../../src/domain/isbn.ts";
import { itemSchema } from "../../src/domain/item.ts";
import {
  draftFromScan,
  preselectedMatch,
  scanLookupRequestSchema,
  scanLookupResultSchema,
} from "../../src/domain/scan.ts";
import type { ScanEdition, ScanLookupResult, ScanMatch } from "../../src/domain/scan.ts";
import {
  editionConflicts,
  googleEditions,
  openLibraryEditions,
  parseCatalogTitle,
  rankEditions,
} from "../../src/server/scan/catalog.ts";
import { reconcile, sharesCreator, titleKey, titleSimilarity } from "../../src/server/scan/reconcile.ts";
import type { CollectionIndex } from "../../src/server/scan/reconcile.ts";
import { cameraProblem } from "../../src/components/scan/camera.ts";
import { pickIsbn } from "../../src/components/scan/detector.ts";

test("ISBN-13 and ISBN-10 parse with check digits; 979 has no ISBN-10; X and full-width input are accepted", () => {
  assert.deepEqual(parseIsbn("978-1-9747-1546-6"), { ok: true, isbn13: "9781974715466", isbn10: "1974715469", hint: "EN" });
  assert.deepEqual(parseIsbn("1975358-35x"), { ok: true, isbn13: "9781975358358", isbn10: "197535835X", hint: "EN" });
  assert.deepEqual(parseIsbn("９７８４０６５２６６０９０"), { ok: true, isbn13: "9784065266090", isbn10: "4065266092", hint: "JP" });
  assert.deepEqual(parseIsbn("9798888771389"), { ok: true, isbn13: "9798888771389", isbn10: null, hint: "EN" });
  assert.equal((parseIsbn("9791137323926") as { hint: string }).hint, "KR");
  assert.equal(isbn10To13("4065266092"), "9784065266090");
  assert.equal(isbn13To10("9784065266090"), "4065266092");
  assert.equal(isbn13To10("9798888771389"), null);
  assert.ok(validIsbn13("9781974709939") && !validIsbn13("9781974709930") && !validIsbn13("4901234567894"));
  assert.ok(validIsbn10("197535835X") && !validIsbn10("1975358350"));
  assert.equal(isbnLanguageHint("9788956718339"), "KR");
  assert.equal(isbnLanguageHint("9782811647414"), null, "French registration groups are not guessed");
  assert.equal(formatIsbn("9781974715466"), "978-1974715466");
});

test("invalid codes are rejected with a specific, actionable reason", () => {
  const cases: [string, string][] = [
    ["", "empty"],
    ["9781974715467", "checksum"],
    ["1920979005006", "price-code"],
    ["4901234567894", "not-a-book"],
    ["012345678905", "not-a-book"],
    ["197535835", "length"],
    ["97819747154X6", "characters"],
    ["ISBN 978", "characters"],
  ];
  for (const [code, problem] of cases) {
    const parsed = parseIsbn(code);
    assert.equal(parsed.ok, false, code);
    if (!parsed.ok) {
      assert.equal(parsed.problem, problem, code);
      assert.ok(parsed.message.length > 20);
    }
  }
});

test("the item schema accepts only checksum-valid ISBN-13 values and keeps CD records ISBN-free", () => {
  const base = { kind: "manga", title: "A", volume: "1" };
  assert.equal(itemSchema.parse(base).isbn13, null);
  assert.equal(itemSchema.parse({ ...base, isbn13: "9781974715466" }).isbn13, "9781974715466");
  assert.equal(itemSchema.safeParse({ ...base, isbn13: "1974715469" }).success, false, "ISBN-10 must be converted first");
  assert.equal(itemSchema.safeParse({ ...base, isbn13: "9781974715467" }).success, false);
  assert.equal(itemSchema.safeParse({ kind: "cd", title: "B", isbn13: "9781974715466" }).success, false);
  assert.equal(
    itemSchema.safeParse({ ...base, catalogSource: { provider: "openlibrary", sourceId: "OL1M", sourceUrl: "https://openlibrary.org/books/OL1M" } }).success,
    false,
    "catalog provenance requires the scanned ISBN",
  );
});

test("barcode choice prefers the ISBN when a Japanese price code or a UPC is also visible", () => {
  assert.deepEqual(pickIsbn([{ rawValue: "1920979005006", format: "ean_13" }, { rawValue: "9784065266090", format: "ean_13" }]), parseIsbn("9784065266090"));
  assert.equal(pickIsbn([{ rawValue: "1920979005006", format: "ean_13" }])?.ok, false);
  assert.equal(pickIsbn([]), null);
  assert.deepEqual(pickIsbn([{ rawValue: "9781974715466 51099", format: "ean_13" }]), parseIsbn("9781974715466"), "EAN-5 add-on is dropped");
  assert.deepEqual(pickIsbn([{ rawValue: "978197471546651099", format: "ean_13" }]), parseIsbn("9781974715466"));
});

test("camera failures map to specific recovery messages", () => {
  const error = (name: string) => new DOMException("x", name);
  assert.equal(cameraProblem(error("NotAllowedError")), "denied");
  assert.equal(cameraProblem(error("SecurityError")), "denied");
  assert.equal(cameraProblem(error("NotFoundError")), "missing");
  assert.equal(cameraProblem(error("OverconstrainedError")), "missing");
  assert.equal(cameraProblem(error("NotReadableError")), "busy");
  assert.equal(cameraProblem(new Error("strange")), "unknown");
});

test("catalog titles split into series, volume, medium and format", () => {
  const cases: [string, Partial<ReturnType<typeof parseCatalogTitle>>][] = [
    ["Spy x Family, Vol. 1", { series: "Spy x Family", volume: "1", basis: "marker" }],
    ["チェンソーマン 2", { series: "チェンソーマン", volume: "2", basis: "trailing-number" }],
    ["薫る花は凛と咲く 第3巻", { series: "薫る花は凛と咲く", volume: "3", basis: "marker" }],
    ["SPY×FAMILY 1 (ジャンプコミックス)", { series: "SPY×FAMILY", volume: "1" }],
    ["A Sign of Affection Omnibus 1 (Vol. 1-3)", { series: "A Sign of Affection Omnibus", volume: "1", format: "omnibus" }],
    ["Fruits Basket Collector's Edition, Vol. 5", { series: "Fruits Basket Collector's Edition", volume: "5", format: "collectors" }],
    ["your name. Another Side:Earthbound, Vol. 1 (manga)", { volume: "1", medium: "manga" }],
    ["your name. Another Side:Earthbound (light novel)", { volume: null, medium: "light_novel" }],
    ["Frieren: Beyond Journey's End -Prelude-, Vol. 1 (novel)", { volume: "1", medium: "light_novel" }],
    ["Mob Psycho 100 Volume 2", { series: "Mob Psycho 100", volume: "2", basis: "marker" }],
    ["86: EIGHTY-SIX, Vol. 4", { series: "86: EIGHTY-SIX", volume: "4" }],
    ["Project Hail Mary", { series: "Project Hail Mary", volume: null, basis: null }],
    ["ＳＰＹ×ＦＡＭＩＬＹ　１", { series: "SPY×FAMILY", volume: "1" }],
  ];
  for (const [title, expected] of cases) {
    const parsed = parseCatalogTitle(title);
    for (const [field, value] of Object.entries(expected))
      assert.equal(parsed[field as keyof typeof parsed], value, `${title} → ${field}`);
  }
});

const googlePayload = (identifiers: string[], extra: Record<string, unknown> = {}) => ({
  items: [
    {
      id: "abc_123",
      volumeInfo: {
        title: "Spy x Family, Vol. 1",
        authors: ["Tatsuya Endo"],
        publisher: "VIZ Media LLC",
        language: "en",
        industryIdentifiers: identifiers.map((identifier) => ({ type: identifier.length === 13 ? "ISBN_13" : "ISBN_10", identifier })),
        imageLinks: { thumbnail: "http://books.google.com/books/content?id=abc&printsec=frontcover&edge=curl&key=SHOULD_NOT_SURVIVE" },
        categories: ["Comics & Graphic Novels / Manga / General"],
        ...extra,
      },
      saleInfo: { isEbook: false },
    },
  ],
});

test("Google records apply only when they list the scanned ISBN; cover URLs are sanitized", () => {
  const [verified] = googleEditions(googlePayload(["9781974715466", "1974715469"]), "9781974715466", "1974715469");
  assert.equal(verified!.isbnVerified, true);
  assert.equal(verified!.language, "EN");
  assert.equal(verified!.medium, "manga");
  assert.equal(verified!.volume, "1");
  assert.equal(verified!.cover, "https://books.google.com/books/content?id=abc&printsec=frontcover");
  const [byIsbn10] = googleEditions(googlePayload(["1974715469"]), "9781974715466", "1974715469");
  assert.equal(byIsbn10!.isbnVerified, true, "an ISBN-10 identifier verifies the same book");
  const [other] = googleEditions(googlePayload(["9781974720286"]), "9781974715466", "1974715469");
  assert.equal(other!.isbnVerified, false);
  assert.match(other!.warnings.join(" "), /does not list the scanned ISBN/);
  const [unsafe] = googleEditions(googlePayload(["9781974715466"], { imageLinks: { thumbnail: "https://evil.example/c.jpg" }, language: "fr" }), "9781974715466", null);
  assert.equal(unsafe!.cover, null);
  assert.equal(unsafe!.language, null);
  assert.match(unsafe!.warnings.join(" "), /not an edition language/);
  const [series] = googleEditions(googlePayload(["9781974715466"], { seriesInfo: { bookDisplayNumber: "7" } }), "9781974715466", null);
  assert.equal(series!.volume, "7");
  assert.equal(series!.volumeBasis, "series-data");
  assert.match(series!.warnings.join(" "), /differs from the title/);
  assert.deepEqual(googleEditions({ items: [{ id: "../bad", volumeInfo: { title: "x" } }] }, "9781974715466", null), []);
  assert.deepEqual(googleEditions("not json object", "9781974715466", null), []);
});

test("Open Library details yield language, physical format, series and verified identifiers", () => {
  const payload = {
    "ISBN:9784065266090": {
      details: {
        key: "/books/OL1M",
        title: "薫る花は凛と咲く 1",
        publishers: ["講談社"],
        languages: [{ key: "/languages/jpn" }],
        physical_format: "Paperback",
        series: ["薫る花は凛と咲く"],
        isbn_13: ["9784065266090"],
        covers: [123],
      },
    },
  };
  const [edition] = openLibraryEditions(payload, "9784065266090", "4065266092");
  assert.equal(edition!.language, "JP");
  assert.equal(edition!.seriesTitle, "薫る花は凛と咲く");
  assert.equal(edition!.volume, "1");
  assert.equal(edition!.isbnVerified, true);
  assert.equal(edition!.ebook, false);
  assert.equal(edition!.cover, "https://covers.openlibrary.org/b/id/123-L.jpg?default=false");
  const ebook = openLibraryEditions({ x: { details: { ...payload["ISBN:9784065266090"].details, physical_format: "eBook" } } }, "9784065266090", null);
  assert.equal(ebook[0]!.ebook, true);
  assert.deepEqual(openLibraryEditions({ x: { details: { key: "javascript:alert(1)", title: "x" } } }, "9784065266090", null), []);
  assert.deepEqual(openLibraryEditions({}, "9784065266090", null), [], "an empty answer is no record, not an error");
});

const edition = (patch: Partial<ScanEdition> = {}): ScanEdition => ({
  provider: "openlibrary",
  sourceId: "OL1M",
  sourceUrl: "https://openlibrary.org/books/OL1M",
  title: "Chainsaw Man, Vol. 2",
  seriesTitle: "Chainsaw Man",
  volume: "2",
  volumeBasis: "marker",
  authors: ["Tatsuki Fujimoto"],
  publisher: "VIZ Media",
  language: "EN",
  publishedDate: "2021",
  pageCount: 192,
  medium: "manga",
  format: null,
  isbnVerified: true,
  ebook: false,
  cover: null,
  warnings: [],
  ...patch,
});

test("ranking puts verified printed records first and conflicting catalogs are disclosed", () => {
  const ranked = rankEditions([edition({ isbnVerified: false, sourceId: "bad" }), edition({ ebook: true, sourceId: "ebook" }), edition({ sourceId: "print" })]);
  assert.deepEqual(ranked.map((value) => value.sourceId), ["print", "ebook", "bad"]);
  assert.match(editionConflicts([edition(), edition({ volume: "3" })]).join(" "), /disagree about the volume/);
  assert.match(editionConflicts([edition(), edition({ language: "JP" })]).join(" "), /disagree about the edition language/);
  assert.deepEqual(editionConflicts([edition(), edition({ volume: "3", isbnVerified: false })]), []);
});

test("title keys and similarity handle punctuation, ×, articles, containment and scripts", () => {
  assert.equal(titleKey("SPY×FAMILY"), titleKey("Spy x Family"));
  assert.equal(titleKey("Girls' Last Tour"), titleKey("Girls Last Tour"));
  assert.equal(titleKey("A Sign of Affection"), titleKey("Sign of Affection"));
  assert.equal(titleSimilarity("Laid-Back Camp", "Laid Back Camp"), 1);
  assert.equal(titleSimilarity("Fruits Basket", "Fruits Basket: Collector's Edition"), 0.7, "related editions are offered, not preselected");
  assert.ok(titleSimilarity("Chainsaw Man", "Sayonara Eri") < 0.3);
  assert.ok(titleSimilarity("チェンソーマン", "チェンソーマン外伝") >= 0.7);
  assert.ok(titleSimilarity("チェンソーマン", "Chainsaw Man") === 0);
  assert.ok(sharesCreator(["Fujimoto Tatsuki"], ["Tatsuki Fujimoto"]));
  assert.ok(sharesCreator(["Yoshitoki Ōima"], ["Yoshitoki Oima"]));
  assert.ok(!sharesCreator(["藤本タツキ"], ["Tatsuki Fujimoto"]), "cross-script names are not guessed");
});

const index: CollectionIndex = {
  series: [
    {
      id: "csm",
      title: "Chainsaw Man",
      aliases: [],
      authors: ["Tatsuki Fujimoto"],
      runs: [{ id: "csm-en", editionTitle: "Chainsaw Man", language: "EN", languageBasis: "assumed", publisher: "VIZ Media", format: "standard", numberingBasis: "printed", medium: "manga" }],
    },
    {
      id: "fb",
      title: "Fruits Basket: Collector's Edition",
      aliases: [],
      authors: ["Natsuki Takaya"],
      runs: [{ id: "fb-ce", editionTitle: "Fruits Basket: Collector's Edition", language: "EN", languageBasis: "assumed", publisher: "Yen Press", format: "collectors", numberingBasis: "printed", medium: "manga" }],
    },
  ],
  volumes: [
    { runId: "csm-en", volume: "2", isbn13: null, copies: [{ id: "copy-1", acquiredOn: "2021-11-15" }] },
    { runId: "fb-ce", volume: "1", isbn13: null, copies: [{ id: "copy-2", acquiredOn: null }] },
  ],
};
const input = (patch: Partial<Parameters<typeof reconcile>[1]> = {}) => ({
  editions: [edition()],
  language: "EN" as const,
  volume: "2",
  medium: "manga" as const,
  format: null,
  ...patch,
});

test("reconciliation finds owned volumes, keeps exact run identity and never pairs other languages or formats", () => {
  const [owned] = reconcile(index, input());
  assert.equal(owned!.seriesId, "csm");
  assert.equal(owned!.score, 1);
  assert.equal(owned!.run!.languageBasis, "assumed", "the owned run's identity is passed through");
  assert.deepEqual(owned!.copies.map((copy) => copy.id), ["copy-1"]);
  const [japanese] = reconcile(index, input({ language: "JP", editions: [edition({ language: "JP" })] }));
  assert.equal(japanese!.run, null, "a Japanese volume 2 is not the English volume 2");
  assert.deepEqual(japanese!.copies, []);
  const [standard] = reconcile(index, input({ editions: [edition({ title: "Fruits Basket, Vol. 1", seriesTitle: "Fruits Basket", authors: ["Natsuki Takaya"] })], volume: "1" }));
  assert.equal(standard!.seriesId, "fb");
  assert.ok(standard!.score < 0.8, "related but not preselected");
  assert.equal(standard!.run, null, "a standard volume is not the collector's edition");
  const [novel] = reconcile(index, input({ medium: "light_novel" }));
  assert.ok(novel!.score <= 0.8);
  assert.equal(novel!.run, null);
  assert.match(novel!.reasons.join(" "), /suggests a light novel/);
  assert.deepEqual(reconcile(index, input({ editions: [edition({ isbnVerified: false })] })), [], "unverified records never drive a match");
  const [bridged] = reconcile(index, input({ editions: [edition({ title: "チェンソーマン 2", seriesTitle: "チェンソーマン", authors: ["藤本タツキ"], language: "JP" })], language: "JP", bridgeTitles: ["Chainsaw Man", "チェンソーマン"] }));
  assert.equal(bridged!.basis, "bridge");
  assert.equal(bridged!.seriesId, "csm");
});

const lookup = (patch: Partial<ScanLookupResult> = {}): ScanLookupResult =>
  scanLookupResultSchema.parse({
    isbn13: "9781974709946",
    isbn10: "1974709949",
    languageHint: "EN",
    editions: [],
    matches: [],
    duplicate: { level: "none", copies: [] },
    local: false,
    warnings: [],
    failures: [],
    ...patch,
  });
const match = (patch: Partial<ScanMatch> = {}): ScanMatch => ({
  seriesId: "csm",
  seriesTitle: "Chainsaw Man",
  aliases: [],
  authors: ["Tatsuki Fujimoto"],
  medium: "manga",
  run: { editionTitle: "Chainsaw Man", language: "EN", languageBasis: "assumed", publisher: "VIZ Media", format: "standard", numberingBasis: "printed" },
  volume: "2",
  copies: [],
  recordedIsbn: null,
  basis: "title",
  score: 1,
  reasons: [],
  ...patch,
});

test("drafts keep only the scanned ISBN, prefer collection data, and flag every unknown", () => {
  const providerIsbnEdition = edition({ publisher: "SHONEN JUMP" });
  const draft = draftFromScan(lookup({ editions: [providerIsbnEdition] }), providerIsbnEdition, match());
  assert.equal(draft.item.isbn13, "9781974709946");
  assert.equal(draft.item.seriesId, "csm");
  assert.equal(draft.item.publisher, "VIZ Media", "the owned run's publisher keeps the edition together");
  assert.equal(draft.item.languageBasis, "assumed");
  assert.equal(draft.sources.title, "collection");
  assert.deepEqual(draft.flags, []);
  const empty = draftFromScan(lookup({ languageHint: "JP" }), null, null);
  assert.equal(empty.item.title, "");
  assert.equal(empty.item.volume, "");
  assert.equal(empty.item.language, "JP");
  assert.equal(empty.item.languageBasis, "assumed");
  assert.equal(empty.item.artwork, undefined);
  assert.equal(empty.item.publisher, "");
  assert.deepEqual(empty.item.authors, []);
  assert.equal(empty.sources.title, "missing");
  assert.ok(empty.flags.length >= 2, "language and medium assumptions are flagged");
  assert.match(empty.fieldFlags.title!, /Type the series title/);
  assert.match(empty.fieldFlags.volume!, /number printed on the spine/);
  assert.deepEqual(draft.fieldFlags, {});
  const unverified = edition({ isbnVerified: false, title: "Some other book", seriesTitle: "Some other book" });
  const ignored = draftFromScan(lookup({ editions: [unverified] }), unverified, null);
  assert.equal(ignored.item.title, "", "unverified catalog data is never applied");
  assert.match(ignored.flags.join(" "), /No catalog record lists this exact ISBN/);
  const trailing = draftFromScan(lookup({ editions: [edition({ volumeBasis: "trailing-number" })] }), edition({ volumeBasis: "trailing-number" }), null);
  assert.match(trailing.flags.join(" "), /Check it against the spine/);
  const conflict = draftFromScan(lookup(), edition(), match({ recordedIsbn: "9781974709939" }));
  assert.match(conflict.flags.join(" "), /already records ISBN 9781974709939/);
  const ebook = draftFromScan(lookup(), edition({ ebook: true }), null);
  assert.match(ebook.flags.join(" "), /eBook/);
  const recorded = draftFromScan(lookup(), edition({ volume: "9" }), match({ basis: "isbn", volume: "2" }));
  assert.equal(recorded.item.volume, "2", "the owner's recorded volume for this ISBN wins");
  assert.equal(itemSchema.safeParse(draft.item).success, true);
});

test("only strong matches are preselected; request and result schemas are strict", () => {
  assert.equal(preselectedMatch(lookup({ matches: [match({ score: 0.79 })] })), null);
  assert.equal(preselectedMatch(lookup({ matches: [match({ score: 0.8 })] }))?.seriesId, "csm");
  assert.equal(scanLookupRequestSchema.safeParse({ code: "9781974709946", source: "camera", image: "data:…" }).success, false);
  assert.equal(scanLookupRequestSchema.safeParse({ code: "x".repeat(33), source: "camera" }).success, false);
  assert.equal(scanLookupResultSchema.safeParse({ ...lookup(), extra: true }).success, false);
  assert.equal(scanLookupResultSchema.safeParse({ ...lookup(), isbn13: "1234567890123" }).success, false);
});
