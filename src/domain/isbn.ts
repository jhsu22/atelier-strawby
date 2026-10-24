// ISBN parsing shared by the browser scanner, the editor and the server.
// Only checksum-valid book identifiers are accepted; nothing here guesses digits.

export type IsbnLanguageHint = "EN" | "JP" | "KR";
export type IsbnProblem =
  | "empty"
  | "characters"
  | "length"
  | "checksum"
  | "price-code"
  | "not-a-book";
export type IsbnParse =
  | { ok: true; isbn13: string; isbn10: string | null; hint: IsbnLanguageHint | null }
  | { ok: false; problem: IsbnProblem; message: string };

const messages: Record<IsbnProblem, string> = {
  empty: "Enter or scan an ISBN.",
  characters: "An ISBN contains only digits (and a final X for ISBN-10).",
  length: "An ISBN has 10 or 13 digits.",
  checksum: "That number fails the ISBN check digit. Rescan or check for a typo.",
  // Japanese books print a second 192/191 barcode with the price and genre code.
  "price-code": "That is the Japanese price barcode. Scan the upper barcode that starts with 978.",
  "not-a-book": "That barcode is a retail product code, not an ISBN. Look for the barcode starting with 978 or 979.",
};
const fail = (problem: IsbnProblem): IsbnParse => ({ ok: false, problem, message: messages[problem] });

export function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}
export function isbn10CheckDigit(first9: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(first9[i]) * (10 - i);
  const digit = (11 - (sum % 11)) % 11;
  return digit === 10 ? "X" : String(digit);
}
export const validIsbn13 = (value: string) =>
  /^97[89]\d{10}$/.test(value) && isbn13CheckDigit(value.slice(0, 12)) === value[12];
export const validIsbn10 = (value: string) =>
  /^\d{9}[\dX]$/.test(value) && isbn10CheckDigit(value.slice(0, 9)) === value[9];

export function isbn10To13(isbn10: string): string {
  const base = `978${isbn10.slice(0, 9)}`;
  return base + isbn13CheckDigit(base);
}
/** 979-prefixed ISBNs have no ISBN-10 form. */
export function isbn13To10(isbn13: string): string | null {
  if (!isbn13.startsWith("978")) return null;
  const base = isbn13.slice(3, 12);
  return base + isbn10CheckDigit(base);
}

/**
 * Registration-group hint. This identifies where the ISBN was registered, not
 * the language printed in the book, so callers must label it as an assumption.
 */
export function isbnLanguageHint(isbn13: string): IsbnLanguageHint | null {
  if (/^9784/.test(isbn13)) return "JP";
  if (/^97889|^97911/.test(isbn13)) return "KR";
  if (/^978[01]|^9798/.test(isbn13)) return "EN";
  return null;
}

export function parseIsbn(raw: string): IsbnParse {
  // NFKC folds full-width digits typed on Japanese keyboards.
  const value = raw.normalize("NFKC").replace(/[\s\-‐‑–—_.]/g, "").toUpperCase();
  if (!value) return fail("empty");
  if (!/^\d+X?$/.test(value)) return fail("characters");
  if (value.length === 10) {
    if (!validIsbn10(value)) return fail("checksum");
    const isbn13 = isbn10To13(value);
    return { ok: true, isbn13, isbn10: value, hint: isbnLanguageHint(isbn13) };
  }
  // UPC-A (12 digits) is a retail code; some US books carry it beside the ISBN.
  if (value.length === 12) return fail("not-a-book");
  if (value.length !== 13 || value.includes("X")) return fail("length");
  if (isbn13CheckDigit(value.slice(0, 12)) !== value[12]) return fail("checksum");
  if (/^19[12]/.test(value)) return fail("price-code");
  if (!/^97[89]/.test(value)) return fail("not-a-book");
  return { ok: true, isbn13: value, isbn10: isbn13To10(value), hint: isbnLanguageHint(value) };
}

/** Human-readable grouping is locale-specific; a plain 3-10 split stays honest. */
export const formatIsbn = (isbn13: string) => `${isbn13.slice(0, 3)}-${isbn13.slice(3)}`;
