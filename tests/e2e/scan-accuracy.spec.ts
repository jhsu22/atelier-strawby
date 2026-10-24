import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installBarcodeArt, installFakeCamera, VARIANTS } from "../helpers/barcode-art.ts";

// Barcode decoding accuracy, measured through the app's own photo and live
// camera paths, separately from catalog lookup accuracy. Images are synthetic
// renderings of the test-set ISBNs; set STRAWBY_BARCODE_PHOTOS to a folder of
// real photos named "<isbn>-anything.jpg" to measure those too.
test.skip(process.env.STRAWBY_TEST_READ_ONLY === "true", "Scanning is an owner tool.");
test.describe.configure({ timeout: 900_000 });

const FAILURES = /No barcode was found|price barcode|retail product code|could not be read|check digit|10 or 13 digits/;
type Outcome = { decoded: string | null; problem: string | null; ms: number };

async function setup(page: Page) {
  await page.addInitScript(installBarcodeArt);
  await page.addInitScript(installFakeCamera, {});
  // Count completed photo reads: the "Reading the photo" hint is removed when one ends.
  await page.addInitScript(() => {
    const w = window as unknown as { __photoReads: number };
    w.__photoReads = 0;
    let reading = false;
    new MutationObserver(() => {
      const now = document.body?.innerText.includes("Reading the photo on this device") ?? false;
      if (reading && !now) w.__photoReads++;
      reading = now;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const lookups: { code: string; at: number }[] = [];
  await page.route("**/api/scan/isbn", async (route) => {
    lookups.push({ code: (route.request().postDataJSON() as { code: string }).code, at: Date.now() });
    await route.fulfill({ status: 503, json: { error: "Benchmark: lookup intentionally skipped." } });
  });
  await page.goto("/");
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await page.getByRole("button", { name: "Add to collection", exact: true }).click();
  await page.getByRole("button", { name: "Scan barcode", exact: true }).click();
  const engine = await page.evaluate(() => ("BarcodeDetector" in window ? "native-or-polyfill" : "zxing-wasm"));
  return { lookups, engine };
}

async function readPhoto(page: Page, lookups: { code: string; at: number }[], file: { name: string; mimeType: string; buffer: Buffer } | string): Promise<Outcome> {
  const before = lookups.length;
  const reads = await page.evaluate(() => (window as unknown as { __photoReads: number }).__photoReads);
  const started = Date.now();
  await page.getByLabel("Photo of a barcode").setInputFiles(file);
  await page.waitForFunction((count) => (window as unknown as { __photoReads: number }).__photoReads > count, reads, { timeout: 30_000 });
  const problem = (await page.locator('.scan-flow > p[role="alert"]').allTextContents()).find((text) => FAILURES.test(text)) ?? null;
  if (problem) return { decoded: null, problem, ms: Date.now() - started };
  await expect.poll(() => lookups.length, { timeout: 5_000 }).toBeGreaterThan(before);
  return { decoded: lookups.at(-1)!.code, problem: null, ms: lookups.at(-1)!.at - started };
}

async function render(page: Page, isbn: string, variant: string, seed: number) {
  const data = await page.evaluate(
    ([code, kind, n]) => {
      const canvas = document.createElement("canvas");
      (window as unknown as { __barcodeArt: { draw: (c: HTMLCanvasElement, i: string, v: string, s: number) => void } }).__barcodeArt.draw(canvas, code as string, kind as string, n as number);
      return canvas.toDataURL("image/jpeg", 0.85).split(",")[1]!;
    },
    [isbn, variant, seed] as const,
  );
  return { name: `${isbn}-${variant}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(data, "base64") };
}

const rate = (rows: { correct: boolean }[]) => `${rows.filter((row) => row.correct).length}/${rows.length}`;

test("barcode decoding accuracy: synthetic photos, live camera frames and optional real photos", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Same Chromium engine in both projects; measured once.");
  const { cases } = JSON.parse(await readFile("tests/fixtures/scan/isbn-cases.json", "utf8")) as { cases: { isbn: string; tags: string[] }[] };
  const { lookups, engine } = await setup(page);

  const photos: { isbn: string; variant: string; correct: boolean; wrong: boolean; decoded: string | null; problem: string | null; ms: number }[] = [];
  for (const variant of VARIANTS)
    for (const [index, entry] of cases.entries()) {
      const outcome = await readPhoto(page, lookups, await render(page, entry.isbn, variant, index + 1));
      photos.push({ isbn: entry.isbn, variant, ...outcome, correct: outcome.decoded === entry.isbn, wrong: outcome.decoded !== null && outcome.decoded !== entry.isbn });
    }

  // Live camera: a fake rear camera streams the rendered label into the real
  // scanner (crop, two-read confirmation, stream release).
  const cameraVariants = ["clean", "far", "tilted-8deg", "glare", "low-contrast-noise", "jp-two-barcodes"];
  const camera: { isbn: string; variant: string; correct: boolean; wrong: boolean; decoded: string | null; ms: number | null }[] = [];
  for (const variant of cameraVariants)
    for (const [index, entry] of cases.slice(0, 10).entries()) {
      await page.evaluate(
        ([code, kind, n]) => {
          const w = window as unknown as { __barcodeArt: { draw: (c: HTMLCanvasElement, i: string, v: string, s: number) => void }; __fakeCamera: HTMLCanvasElement };
          w.__barcodeArt.draw(w.__fakeCamera, code as string, kind as string, n as number);
        },
        [entry.isbn, variant, index + 100] as const,
      );
      const before = lookups.length;
      const started = Date.now();
      await page.getByRole("button", { name: /Open camera|Scan next book/ }).click();
      let decoded: string | null = null;
      try {
        await expect.poll(() => lookups.length, { timeout: 6_000 }).toBeGreaterThan(before);
        decoded = lookups.at(-1)!.code;
      } catch {
        // No read within six seconds counts as a miss; close the camera.
        await page.getByRole("button", { name: "Stop camera" }).click();
      }
      camera.push({ isbn: entry.isbn, variant, decoded, correct: decoded === entry.isbn, wrong: decoded !== null && decoded !== entry.isbn, ms: decoded ? lookups.at(-1)!.at - started : null });
      await expect(page.getByRole("button", { name: /Open camera/ })).toBeVisible();
    }

  const real: { file: string; expected: string; decoded: string | null; correct: boolean; wrong: boolean; problem: string | null }[] = [];
  const folder = process.env.STRAWBY_BARCODE_PHOTOS;
  if (folder)
    for (const file of (await readdir(folder)).filter((name) => /^\d{13}.*\.(jpe?g|png|heic|webp)$/i.test(name)).sort()) {
      const expected = file.slice(0, 13);
      const outcome = await readPhoto(page, lookups, join(folder, file));
      real.push({ file, expected, decoded: outcome.decoded, problem: outcome.problem, correct: outcome.decoded === expected, wrong: outcome.decoded !== null && outcome.decoded !== expected });
    }

  const byVariant = Object.fromEntries(VARIANTS.map((variant) => [variant, rate(photos.filter((row) => row.variant === variant))]));
  const cameraByVariant = Object.fromEntries(cameraVariants.map((variant) => [variant, rate(camera.filter((row) => row.variant === variant))]));
  const times = camera.flatMap((row) => (row.ms === null ? [] : [row.ms])).sort((a, b) => a - b);
  const summary = {
    measuredAt: new Date().toISOString(),
    browser: `Chromium ${page.context().browser()?.version()}`,
    engine,
    photos: { total: rate(photos), wrongReads: photos.filter((row) => row.wrong).length, byVariant },
    camera: {
      total: rate(camera),
      wrongReads: camera.filter((row) => row.wrong).length,
      byVariant: cameraByVariant,
      medianMsToLookup: times[Math.floor(times.length / 2)] ?? null,
      slowestMsToLookup: times.at(-1) ?? null,
    },
    realPhotos: folder ? { total: rate(real), wrongReads: real.filter((row) => row.wrong).length } : "not measured: set STRAWBY_BARCODE_PHOTOS",
  };
  await mkdir("data/generated", { recursive: true });
  await writeFile("data/generated/scan-barcode-accuracy.json", `${JSON.stringify({ summary, photos, camera, real }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  // A misread ISBN is worse than no read: it must never happen.
  expect(summary.photos.wrongReads).toBe(0);
  expect(summary.camera.wrongReads).toBe(0);
  if (folder) expect(real.filter((row) => row.wrong)).toEqual([]);
  // Regression floor: undistorted labels always decode on both paths.
  expect(byVariant.clean).toBe(`${cases.length}/${cases.length}`);
  expect(cameraByVariant.clean).toBe("10/10");
});
