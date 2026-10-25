import { parseIsbn } from "../../domain/isbn.ts";
import type { IsbnParse } from "../../domain/isbn.ts";
import { parseScanCode } from "../../domain/barcode.ts";
import type { ScanCode } from "../../domain/barcode.ts";

// Barcodes are decoded on the device. Neither frames nor photos are uploaded.
export type Engine = "native" | "zxing";
export interface Detected {
  rawValue: string;
  format: string;
}
export interface Detector {
  engine: Engine;
  detect(source: HTMLCanvasElement | ImageBitmap): Promise<Detected[]>;
}
// EAN-13 carries ISBNs and most CD barcodes; UPC-A/E are North American CDs.
const FORMATS = ["ean_13", "upc_a", "upc_e"] as const;

interface NativeDetector {
  detect(source: HTMLCanvasElement | ImageBitmap): Promise<Detected[]>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

let loading: Promise<Detector> | null = null;
/** Native BarcodeDetector where it reads EAN-13, otherwise ZXing WebAssembly. */
export function loadDetector(): Promise<Detector> {
  loading ??= (async (): Promise<Detector> => {
    const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
    if (Native) {
      try {
        const supported = await Native.getSupportedFormats();
        if (supported.includes("ean_13")) {
          const detector = new Native({ formats: FORMATS.filter((format) => supported.includes(format)) });
          return { engine: "native", detect: (source) => detector.detect(source) };
        }
      } catch {
        /* Fall through to the WebAssembly reader. */
      }
    }
    const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
      import("barcode-detector/ponyfill"),
      import("zxing-wasm/reader/zxing_reader.wasm?url"),
    ]);
    // Self-hosted, versioned with this build; no third-party CDN request.
    await prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
      fireImmediately: true,
    });
    const detector = new BarcodeDetector({ formats: [...FORMATS] });
    return { engine: "zxing", detect: (source) => detector.detect(source) };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

// Some readers append a US price add-on ("9781974715466 51099"); the code is
// the 12- or 13-digit symbol before it.
const withoutAddOn = (value: string) => value.replace(/^(\d{12,13})[\s-]?\d{2}(?:\d{3})?$/, "$1");
/** Choose the ISBN among decoded barcodes, or explain why there is none. */
export function pickIsbn(results: Detected[]): IsbnParse | null {
  const parsed = results.map((result) => parseIsbn(withoutAddOn(result.rawValue)));
  return parsed.find((entry) => entry.ok) ?? parsed[0] ?? null;
}
/** Books and CDs: an ISBN wins over a retail code in the same frame. */
export function pickCode(results: Detected[]): ScanCode | null {
  const parsed = results.map((result) => parseScanCode(withoutAddOn(result.rawValue)));
  return parsed.find((entry) => entry.kind === "isbn") ?? parsed.find((entry) => entry.kind === "cd") ?? parsed[0] ?? null;
}

/**
 * Grey-scale contrast stretch between the 2nd and 98th luminance percentiles.
 * Dim, low-contrast labels then binarize cleanly; a second pass costs a few ms.
 */
export function enhanceContrast(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4)
    histogram[(data[i]! * 77 + data[i + 1]! * 150 + data[i + 2]! * 29) >> 8]!++;
  const pixels = data.length / 4;
  let low = 0, high = 255, seen = 0;
  for (; low < 255 && (seen += histogram[low]!) < pixels * 0.02; low++);
  seen = 0;
  for (; high > 0 && (seen += histogram[high]!) < pixels * 0.02; high--);
  const range = Math.max(1, high - low);
  for (let i = 0; i < data.length; i += 4) {
    const luminance = (data[i]! * 77 + data[i + 1]! * 150 + data[i + 2]! * 29) >> 8;
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, ((luminance - low) * 255) / range));
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

const MAX_EDGE = 2000;
async function photoCanvas(file: Blob, edge: number) {
  // EXIF orientation is applied by createImageBitmap's default imageOrientation.
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d", { willReadFrequently: true })!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}
/** Decode a still photo, downscaled so 12-megapixel images stay quick. */
export async function detectInFile(file: Blob, detector: Detector): Promise<Detected[]> {
  const canvas = await photoCanvas(file, MAX_EDGE);
  const results = await detector.detect(canvas);
  return results.length ? results : await detector.detect(enhanceContrast(canvas));
}
/**
 * A book or CD code from a still photo. A blurred ISBN can decode as a
 * different, checksum-valid retail code, so a CD code from one photo needs a
 * second, independent read (contrast-stretched or at another scale) to agree.
 * The live camera gets the same protection from two consecutive frames.
 */
export async function pickCodeInFile(file: Blob, detector: Detector): Promise<ScanCode | null> {
  const picked = pickCode(await detectInFile(file, detector));
  if (picked?.kind !== "cd") return picked;
  const canvas = await photoCanvas(file, MAX_EDGE);
  for (const source of [enhanceContrast(canvas), await photoCanvas(file, 1000)]) {
    const again = pickCode(await detector.detect(source));
    if (again?.kind === "cd" && again.code === picked.code) return picked;
  }
  return { kind: "problem", message: "That barcode could not be read reliably. Take a closer, sharper photo, or type the number." };
}
