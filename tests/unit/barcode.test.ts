import test from "node:test";
import assert from "node:assert/strict";
import { barcodeForms, formatBarcode, parseProductBarcode, parseScanCode, upcEToA } from "../../src/domain/barcode.ts";
import { cdOwnershipAnswer, offlineCdLookup, sameAlbum } from "../../src/domain/cd-scan.ts";
import type { CdLookupResult } from "../../src/domain/cd-scan.ts";
import { pickCode, pickIsbn } from "../../src/components/scan/detector.ts";
import { itemSchema } from "../../src/domain/item.ts";
import type { CdAlbum } from "../../src/domain/library.ts";

const EAN = "4547366423815";
const UPC_A = "074644057829";

test("CD barcodes are checksum-checked and stored as one 13-digit form", () => {
  assert.deepEqual(parseProductBarcode(EAN), { ok: true, gtin13: EAN });
  assert.deepEqual(parseProductBarcode(UPC_A), { ok: true, gtin13: `0${UPC_A}` });
  assert.deepEqual(parseProductBarcode(` 0 74644-05782 9 `), { ok: true, gtin13: `0${UPC_A}` });
  assert.equal(upcEToA("01234565"), "012345000065");
  assert.deepEqual(parseProductBarcode("01234565"), { ok: true, gtin13: "0012345000065" }, "UPC-E expands to its UPC-A");
  assert.equal(parseProductBarcode("4547366423816").ok, false);
  assert.equal(parseProductBarcode("12345").ok, false);
  assert.equal(parseProductBarcode("45473664238A5").ok, false);
  assert.equal(formatBarcode(`0${UPC_A}`), UPC_A, "UPC-A is shown as printed");
  assert.deepEqual(barcodeForms(`0${UPC_A}`), [`0${UPC_A}`, UPC_A]);
  assert.deepEqual(barcodeForms(EAN), [EAN]);
});

test("a scanned code goes to the book flow as an ISBN, otherwise to the CD flow", () => {
  assert.equal(parseScanCode("9781974715466").kind, "isbn");
  assert.equal(parseScanCode("4-08-881831-X").kind, "problem", "a bad ISBN-10 stays a book problem");
  assert.deepEqual(parseScanCode(EAN), { kind: "cd", code: EAN });
  assert.deepEqual(parseScanCode(UPC_A), { kind: "cd", code: `0${UPC_A}` });
  const price = parseScanCode("1920979006508");
  assert.equal(price.kind, "problem");
  assert.match(price.kind === "problem" ? price.message : "", /price barcode/);
  const typo = parseScanCode("9781974715467");
  assert.match(typo.kind === "problem" ? typo.message : "", /ISBN check digit/);
  // An ISBN beats a retail code in the same frame; add-ons are stripped.
  assert.equal(pickCode([{ rawValue: UPC_A, format: "upc_a" }, { rawValue: "9781974715466", format: "ean_13" }])?.kind, "isbn");
  assert.deepEqual(pickCode([{ rawValue: `${UPC_A} 51099`, format: "upc_a" }]), { kind: "cd", code: `0${UPC_A}` });
  assert.equal(pickIsbn([{ rawValue: EAN, format: "ean_13" }])?.ok, false, "the book-only scanner still rejects CDs");
});

test("items store a CD barcode in its 13-digit form; books cannot carry one", () => {
  assert.equal(itemSchema.parse({ kind: "cd", title: "Album", barcode: UPC_A }).barcode, `0${UPC_A}`);
  assert.equal(itemSchema.safeParse({ kind: "cd", title: "Album", barcode: "123" }).success, false);
  assert.equal(itemSchema.safeParse({ kind: "manga", title: "Story", barcode: EAN }).success, false);
});

test("the CD check answers owned, another edition of the album, or new", () => {
  const base: CdLookupResult = { barcode: EAN, releases: [], owned: [], albums: [], local: false, warnings: [], failures: [] };
  const release = { id: "11111111-1111-4111-8111-111111111111", title: "Kessoku Band", artists: ["Kessoku Band"], date: "2022-12-28", country: "JP", disambiguation: "", formats: ["CD"], labels: [], trackCount: 14 };
  assert.equal(cdOwnershipAnswer(base).verdict, "new");
  assert.equal(cdOwnershipAnswer({ ...base, releases: [release], albums: [{ entryId: "r", title: "Kessoku Band", copies: 1 }] }).verdict, "album");
  const owned = cdOwnershipAnswer({ ...base, owned: [{ id: "c", entryId: "r", title: "Kessoku Band", acquiredOn: "2023-01-01" }], local: true });
  assert.deepEqual([owned.verdict, owned.entryId, owned.copies.length], ["owned", "r", 1]);
  assert.ok(sameAlbum({ title: "Kessoku Band", artists: ["kessoku band"] }, release));
  assert.ok(!sameAlbum({ title: "Kessoku Band", artists: ["Someone Else"] }, release));
  assert.ok(!sameAlbum({ title: "Other", artists: [] }, release));
  const album = { kind: "cd", id: "r", title: "Kessoku Band", barcode: EAN, artists: [], releaseId: "r", releaseDate: null, formats: [], labels: [], catalogNumbers: [], tracks: [], copies: [{ id: "c", acquiredOn: null, notes: null }] } as CdAlbum;
  assert.equal(cdOwnershipAnswer(offlineCdLookup(EAN, [album])).verdict, "owned");
  assert.equal(cdOwnershipAnswer(offlineCdLookup(`0${UPC_A}`, [album])).verdict, "new");
});
