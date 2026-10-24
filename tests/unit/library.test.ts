import test from "node:test";
import assert from "node:assert/strict";
import {
  browseEntries,
  browseParams,
  cdShelf,
  defaultBrowseState,
  matchingCopies,
  parseBrowseState,
  seriesGaps,
} from "../../src/domain/library.ts";
import type {
  MangaSeries,
  MangaCopy,
  CdAlbum,
  LibraryEntry,
} from "../../src/domain/library.ts";
import { librarySchema } from "../../src/domain/library-schema.ts";

function copy(volume: string, extra: Partial<MangaCopy> = {}): MangaCopy {
  return {
    id: `copy-${volume}`,
    editionRunId: "english",
    editionTitle: "A story",
    publisher: "Publisher",
    language: "EN",
    languageBasis: "assumed",
    volume,
    volumeSort: Number(volume) * 1000,
    numberingBasis: "printed",
    medium: "manga",
    format: "standard",
    acquiredOn: "2024-01-02",
    notes: null,
    tags: [],
    ...extra,
  };
}
const series = (copies: MangaCopy[]): MangaSeries => ({
  kind: "manga",
  id: "story",
  title: "A story",
  authors: ["An author"],
  aliases: ["Another name"],
  copies,
});
const album: CdAlbum = {
  kind: "cd",
  id: "cd",
  title: "A sample album",
  artists: ["A band"],
  releaseId: "release",
  releaseDate: null,
  formats: [],
  labels: [],
  catalogNumbers: [],
  tracks: [],
  copies: [{ id: "cd-copy", acquiredOn: null, notes: null, isSample: true }],
};

test("gap detector reports internal holes, never unowned earlier or future volumes", () => {
  assert.deepEqual(
    seriesGaps(series(["1", "2", "3", "7"].map((value) => copy(value))))[0]!
      .missing,
    ["4–6"],
  );
  assert.deepEqual(
    seriesGaps(series(["4", "7"].map((value) => copy(value))))[0]!.missing,
    ["5–6"],
  );
  assert.deepEqual(seriesGaps(series([copy("5")]))[0]!.missing, []);
});
test("gap detector separates editions and languages and ignores duplicate ownership", () => {
  const groups = seriesGaps(
    series([
      copy("1"),
      copy("1", { id: "duplicate" }),
      copy("3"),
      copy("2", { id: "jp", language: "JP", editionRunId: "japanese" }),
      copy("2", {
        id: "collectors",
        editionRunId: "collectors",
        format: "collectors",
      }),
    ]),
  );
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0]!.missing, ["2"]);
  assert.ok(groups.slice(1).every((group) => group.missing.length === 0));
});
test("uncertain omnibus and nonnumeric numbering produce no claimed gaps", () => {
  for (const extra of [
    { numberingBasis: "source_record" as const },
    { volume: "special" },
  ]) {
    const group = seriesGaps(series([copy("1", extra), copy("7")]))[0]!;
    assert.equal(group.uncertain, true);
    assert.deepEqual(group.missing, []);
  }
});
test("large gap ranges are represented compactly", () => {
  assert.deepEqual(
    seriesGaps(series([copy("1"), copy("9999999")]))[0]!.missing,
    ["2–9999998"],
  );
});
test("language, publisher, note search and memory must match the same owned copy", () => {
  const entry = series([
    copy("1", {
      publisher: "English Publisher",
      tags: ["Gifts from Sammy"],
      notes: "from sammy",
    }),
    copy("2", {
      id: "jp",
      language: "JP",
      publisher: "Japanese Publisher",
      notes: "korea trip",
    }),
  ]);
  assert.equal(
    browseEntries([entry], {
      ...defaultBrowseState,
      language: "JP",
      publisher: "English Publisher",
    }).length,
    0,
  );
  assert.equal(
    browseEntries([entry], {
      ...defaultBrowseState,
      language: "JP",
      memory: "Gifts from Sammy",
    }).length,
    0,
  );
  assert.equal(
    browseEntries([entry], {
      ...defaultBrowseState,
      language: "JP",
      query: "sammy",
    }).length,
    0,
  );
  assert.equal(
    browseEntries([entry], {
      ...defaultBrowseState,
      language: "EN",
      query: "sammy",
    }).length,
    1,
  );
  assert.deepEqual(
    matchingCopies(entry, { ...defaultBrowseState, language: "JP" }).map(
      (value) => value.id,
    ),
    ["jp"],
  );
});
test("search covers alternate titles, creators, publishers and safely preserved personal text", () => {
  const entry = series([copy("1", { notes: "from Sammy <3" })]);
  for (const query of ["Another name", "AN AUTHOR", "publisher", "Sammy <3"]) {
    assert.equal(
      browseEntries([entry], { ...defaultBrowseState, query }).length,
      1,
    );
  }
});
test("media filtering includes labeled CD samples without invented manga attributes", () => {
  const entries = [series([copy("1")]), album];
  assert.equal(browseEntries(entries, defaultBrowseState).length, 2);
  assert.deepEqual(
    browseEntries(entries, { ...defaultBrowseState, media: "cd" }),
    [album],
  );
  assert.deepEqual(
    browseEntries(entries, {
      ...defaultBrowseState,
      media: "cd",
      language: "JP",
    }),
    [],
  );
});
test("browse URL state round-trips search, filters, view, media and selected detail", () => {
  const state = {
    ...defaultBrowseState,
    query: "from sammy <3",
    language: "JP",
    memory: "Proxy Hauls",
    publisher: "A Publisher",
    media: "manga" as const,
    view: "spines" as const,
    item: "item-id",
    sort: "recent" as const,
  };
  assert.deepEqual(parseBrowseState(browseParams(state)), state);
  assert.deepEqual(
    parseBrowseState(
      new URLSearchParams(
        "media=invalid&view=invalid&language=FR&sort=invalid",
      ),
    ),
    defaultBrowseState,
  );
});
test("recent sorting keeps unknown acquisition dates last without changing calendar values", () => {
  const dated = series([copy("1")]);
  assert.deepEqual(
    browseEntries([album, dated], {
      ...defaultBrowseState,
      sort: "recent",
    }).map((entry) => entry.id),
    ["story", "cd"],
  );
});
test("library response schema rejects malformed media and incomplete copy payloads", () => {
  assert.equal(
    librarySchema.safeParse({ entries: [album, series([copy("1")])] }).success,
    true,
  );
  for (const entries of [
    [{ kind: "vinyl" }],
    [{ ...album, copies: [{}] }],
    [{ ...album, tracks: [{ medium: 0 }] }],
  ]) {
    assert.equal(librarySchema.safeParse({ entries }).success, false);
  }
});

test("CD shelf view puts every visible CD copy on one shelf, alphabetical by artist then title, unknown artists last", () => {
  const cd = (id: string, title: string, artists: string[], copies = 1) => ({
    kind: "cd" as const,
    id,
    title,
    artists,
    releaseId: `${id}-release`,
    releaseDate: null,
    formats: [],
    labels: [],
    catalogNumbers: [],
    tracks: [],
    copies: Array.from({ length: copies }, (_, i) => ({
      id: `${id}-${i}`,
      acquiredOn: null,
      notes: null,
      isSample: false,
    })),
  });
  const entries = [
    cd("u", "Unknown album", []),
    cd("r", "Your Name OST", ["RADWIMPS"]),
    cd("k2", "We Will", ["Kessoku Band"]),
    cd("s", "Sample", ["susumu Hirasawa"]),
    cd("k1", "Kessoku Band", ["kessoku band"], 2),
  ] as LibraryEntry[];
  const shelf = cdShelf(entries, { ...defaultBrowseState, view: "spines" });
  assert.deepEqual(
    shelf.map(({ copy }) => copy.id),
    ["k1-0", "k1-1", "k2-0", "r-0", "s-0", "u-0"],
  );
  assert.deepEqual(
    cdShelf(entries, { ...defaultBrowseState, media: "manga" }),
    [],
  );
});
