import { isbn13CheckDigit, parseIsbn } from "./isbn.ts";
import type { IsbnParse } from "./isbn.ts";

// Retail barcodes on CDs: EAN-13 (Japan, Europe), UPC-A and its compressed
// UPC-E (North America). All are GTINs, so each is stored in its 13-digit
// GTIN form and the same pressing matches however it was read.

export type BarcodeParse = { ok: true; gtin13: string } | { ok: false; message: string };

/** UPC-E (8 digits with number system and check digit) to UPC-A. */
export function upcEToA(upcE: string): string | null {
  if (!/^[01]\d{7}$/.test(upcE)) return null;
  const [system, d1, d2, d3, d4, d5, d6, check] = [...upcE];
  const body =
    d6 === "0" || d6 === "1" || d6 === "2"
      ? `${d1}${d2}${d6}0000${d3}${d4}${d5}`
      : d6 === "3"
        ? `${d1}${d2}${d3}00000${d4}${d5}`
        : d6 === "4"
          ? `${d1}${d2}${d3}${d4}00000${d5}`
          : `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${system}${body}${check}`;
}
/** The GTIN check digit is the EAN-13 one, read with a leading zero for UPC-A. */
const validGtin13 = (value: string) => /^\d{13}$/.test(value) && isbn13CheckDigit(value.slice(0, 12)) === value[12];

export function parseProductBarcode(raw: string): BarcodeParse {
  const digits = raw.normalize("NFKC").replace(/[\s\-‐‑–—_.]/g, "");
  if (!digits) return { ok: false, message: "Enter or scan a barcode." };
  if (!/^\d+$/.test(digits)) return { ok: false, message: "A barcode contains only digits." };
  const upcA = digits.length === 8 ? upcEToA(digits) : digits.length === 12 ? digits : null;
  const gtin13 = upcA ? `0${upcA}` : digits.length === 13 ? digits : null;
  if (!gtin13) return { ok: false, message: "A CD barcode has 12 or 13 digits (8 for a short UPC-E)." };
  if (!validGtin13(gtin13)) return { ok: false, message: "That number fails the barcode check digit. Rescan or check for a typo." };
  return { ok: true, gtin13 };
}
/** How the barcode is printed: UPC-A keeps its 12 digits. */
export const formatBarcode = (gtin13: string) => (gtin13.startsWith("0") ? gtin13.slice(1) : gtin13);
/** Both forms MusicBrainz may hold for one pressing. */
export const barcodeForms = (gtin13: string) => [...new Set([gtin13, formatBarcode(gtin13)])];

export type ScanCode =
  | { kind: "isbn"; code: string; isbn: Extract<IsbnParse, { ok: true }> }
  | { kind: "cd"; code: string }
  | { kind: "problem"; message: string };

/**
 * A scanned or typed code: an ISBN goes to the book flow, any other valid
 * retail barcode to the CD flow. Japanese book price codes (191/192) are
 * neither, and keep their explanation.
 */
export function parseScanCode(raw: string): ScanCode {
  const isbn = parseIsbn(raw);
  if (isbn.ok) return { kind: "isbn", code: isbn.isbn13, isbn };
  if (isbn.problem === "price-code" || isbn.problem === "characters") return { kind: "problem", message: isbn.message };
  const barcode = parseProductBarcode(raw);
  // A valid 978/979 code always parses as an ISBN above, so this is not a book.
  if (barcode.ok) return { kind: "cd", code: barcode.gtin13 };
  return { kind: "problem", message: isbn.problem === "checksum" ? isbn.message : barcode.message };
}
