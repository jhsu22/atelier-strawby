import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installBarcodeArt, installFakeCamera } from "../helpers/barcode-art.ts";
import type { CdLookupResult } from "../../src/domain/cd-scan.ts";
import type { LibraryData } from "../../src/domain/library.ts";

test.skip(process.env.STRAWBY_TEST_READ_ONLY === "true", "Scanning is an owner tool.");

// MusicBrainz is never contacted: the browser's lookups are answered with
// canned responses, except where the shelf answers a recorded barcode itself.
const EAN = "4547366423815";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const release = (id: string, country: string, catalogNumber: string) => ({
  id,
  title: "Kessoku Band",
  artists: ["Kessoku Band"],
  date: "2022-12-28",
  country,
  disambiguation: "",
  formats: ["CD"],
  labels: [{ name: "Aniplex", catalogNumber }],
  trackCount: 3,
});
const found = (title: string): CdLookupResult => ({
  barcode: EAN,
  releases: [{ ...release(A, "JP", "SVWC-70630"), title }, { ...release(B, "XW", ""), title }],
  owned: [],
  albums: [],
  local: false,
  warnings: [],
  failures: [],
});
const detail = (title: string) => ({
  candidates: [
    {
      id: A,
      provider: "musicbrainz",
      title,
      subtitle: "",
      sourceUrl: `https://musicbrainz.org/release/${A}`,
      detail: false,
      warning: "",
      patch: {
        title,
        artists: ["Kessoku Band"],
        releaseDate: "2022-12-28",
        editionTitle: "JP",
        labels: [{ name: "Aniplex", catalogNumber: "SVWC-70630" }],
        media: [{ position: 1, format: "CD", title: "" }],
        tracks: [
          { medium: 1, position: 1, title: "Seishun Complex", durationMs: 203000 },
          { medium: 1, position: 2, title: "Hitoribocchi Tokyo", durationMs: 232000 },
          { medium: 1, position: 3, title: "Distortion!!", durationMs: 203000 },
        ],
      },
    },
  ],
  warnings: [],
});

async function openScanner(page: Page, info: TestInfo, code: string | null, mode: "Scan barcode" | "Do I own this?") {
  await page.addInitScript(installBarcodeArt);
  await page.addInitScript(installFakeCamera, {});
  const lookups: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/scan/barcode")) lookups.push(request.postDataJSON());
  });
  await page.goto("/");
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  if (code)
    await page.evaluate((value) => {
      const w = window as unknown as { __barcodeArt: { draw: (c: HTMLCanvasElement, i: string, v: string) => void }; __fakeCamera: HTMLCanvasElement };
      w.__barcodeArt.draw(w.__fakeCamera, value, "clean");
    }, code);
  await page.getByRole("button", { name: info.project.name === "mobile" ? "Add" : "Add to collection", exact: true }).click();
  await page.getByRole("button", { name: mode, exact: true }).click();
  return lookups;
}
async function cds(page: Page, title: string) {
  const data = (await (await page.request.get("/api/library/owner")).json()) as LibraryData;
  return data.entries.filter((entry) => entry.kind === "cd" && entry.title === title);
}
async function removeAll(page: Page, origin: string, title: string) {
  const headers = { Origin: origin, "X-Strawby-Request": "1" };
  for (const entry of await cds(page, title))
    for (const copy of entry.copies) {
      const current = await page.request.get(`/api/items/${copy.id}`);
      if (current.ok()) expect((await page.request.delete(`/api/items/${copy.id}`, { headers, data: { version: (await current.json()).version, confirmed: true } })).ok()).toBe(true);
    }
}

test("scanning a CD barcode fills its tracklist and catalog number from the chosen MusicBrainz release", async ({ page, baseURL }, info) => {
  const title = `CD scan browser ${info.project.name}`;
  await page.route("**/api/scan/barcode", (route) => route.fulfill({ json: found(title) }));
  await page.route("**/api/metadata", (route) => route.fulfill({ json: detail(title) }));
  const lookups = await openScanner(page, info, EAN, "Scan barcode");
  try {
    const review = page.getByRole("form", { name: "Review scanned CD" });
    await expect(review).toBeVisible({ timeout: 15_000 });
    expect(lookups).toEqual([{ code: EAN, source: "camera", retry: false }]);
    await expect(review).toContainText(`BARCODE ${EAN}`);
    // Two pressings share the barcode, so nothing is chosen for the owner.
    await expect(review.getByRole("button", { name: "Add to collection" })).toHaveCount(0);
    await review.getByRole("radio", { name: /XW/ }).check();
    await review.getByRole("radio", { name: /SVWC-70630/ }).check();
    await expect(review.getByText("3 tracks")).toBeVisible();
    await expect(review.locator(".cd-release-facts")).toContainText("Aniplex · SVWC-70630");
    await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
    expect((await new AxeBuilder({ page }).include(".drawer").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `data/generated/cd-scan-review-${info.project.name}.png` });
    await review.getByLabel("Acquisition date", { exact: true }).fill("2026-10-24");
    await review.getByRole("textbox", { name: "Notes" }).fill("record store find");
    await review.getByRole("button", { name: "Add to collection", exact: true }).click();
    await expect(page.getByText(`Added ${title}.`, { exact: false })).toBeVisible();
    const [saved] = await cds(page, title);
    expect(saved?.kind === "cd" && saved).toMatchObject({ barcode: EAN, catalogNumbers: ["SVWC-70630"], labels: ["Aniplex"], formats: ["CD"] });
    expect(saved?.kind === "cd" && saved.tracks.map((track) => track.title)).toEqual(["Seishun Complex", "Hitoribocchi Tokyo", "Distortion!!"]);
    expect(saved?.copies[0]).toMatchObject({ acquiredOn: "2026-10-24", notes: "record store find" });
  } finally {
    await removeAll(page, new URL(baseURL!).origin, title);
  }
});

test("do I own this? answers a recorded CD barcode from the shelf, online and offline", async ({ page, baseURL }, info) => {
  const title = `CD check browser ${info.project.name}`;
  const origin = new URL(baseURL!).origin;
  const created = await page.request.post("/api/items", {
    headers: { Origin: origin, "X-Strawby-Request": "1" },
    data: { item: { kind: "cd", title, artists: ["Kessoku Band"], barcode: EAN, acquiredOn: "2024-02-29" }, requestId: crypto.randomUUID() },
  });
  expect(created.status()).toBe(201);
  try {
    await openScanner(page, info, null, "Do I own this?");
    const check = page.getByRole("region", { name: "Do I own this?" });
    // The real lookup: a recorded barcode needs no MusicBrainz request.
    await page.getByRole("textbox", { name: "ISBN or barcode", exact: true }).fill(EAN);
    await page.getByRole("button", { name: "Look up", exact: true }).click();
    await expect(check.getByRole("heading", { name: "Yes, you own this CD." })).toBeVisible();
    await expect(check).toContainText("acquired 2024-02-29");
    expect((await new AxeBuilder({ page }).include(".drawer").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `data/generated/cd-check-${info.project.name}.png` });

    // Adding from a shelf answer asks MusicBrainz for the release details.
    await page.route("**/api/scan/barcode", (route) =>
      route.fulfill({ json: { ...found(title), owned: [{ id: "x", entryId: "x", title, acquiredOn: "2024-02-29" }] } }),
    );
    await page.route("**/api/metadata", (route) => route.fulfill({ json: detail(title) }));
    await check.getByRole("button", { name: "Add another copy" }).click();
    const review = page.getByRole("form", { name: "Review scanned CD" });
    await expect(review).toContainText("You already own this CD");
    await expect(review.getByRole("radio", { name: /SVWC-70630/ })).toBeVisible();
    await review.getByRole("button", { name: "Scan again" }).click();
    await page.unroute("**/api/scan/barcode");
    await page.route("**/api/scan/barcode", (route) => route.abort("internetdisconnected"));
    await page.getByRole("textbox", { name: "ISBN or barcode", exact: true }).fill(EAN);
    await page.getByRole("button", { name: "Look up", exact: true }).click();
    await expect(check.getByRole("heading", { name: "Yes, you own this CD." })).toBeVisible();
    await expect(check).toContainText("answered from the shelf saved on this device");
    await expect(check.getByRole("button", { name: /Add (another copy|this CD)/ })).toHaveCount(0);

    await check.getByRole("button", { name: "Open album" }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(title);
    await expect(page.getByRole("dialog").locator(".release-metadata")).toContainText(EAN);
  } finally {
    await removeAll(page, origin, title);
  }
});

test("the CD lookup endpoint enforces same-origin owner requests, type limits and barcode validation", async ({ page, baseURL }) => {
  const headers = { Origin: new URL(baseURL!).origin, "X-Strawby-Request": "1" };
  expect((await page.request.post("/api/scan/barcode", { data: { code: EAN, source: "manual" } })).status()).toBe(403);
  expect((await page.request.post("/api/scan/barcode", { headers: { ...headers, "Content-Type": "text/plain" }, data: EAN })).status()).toBe(415);
  const invalid = await page.request.post("/api/scan/barcode", { headers, data: { code: "4547366423816", source: "manual" } });
  expect(invalid.status()).toBe(422);
  expect((await invalid.json()).error).toContain("check digit");
  expect((await page.request.post("/api/scan/barcode", { headers, data: { code: "9781974715466", source: "manual" } })).status()).toBe(422);
});

test("a photo of a CD barcode is confirmed by a second read, then looked up", async ({ page }, info) => {
  await page.route("**/api/scan/barcode", (route) => route.fulfill({ json: { ...found("Photo CD"), releases: [] } }));
  const lookups = await openScanner(page, info, null, "Scan barcode");
  await page.getByRole("button", { name: "Stop camera" }).click();
  const photo = await page.evaluate((code) => {
    const canvas = document.createElement("canvas");
    (window as unknown as { __barcodeArt: { draw: (c: HTMLCanvasElement, i: string, v: string, s: number) => void } }).__barcodeArt.draw(canvas, code, "clean", 1);
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1]!;
  }, EAN);
  await page.getByLabel("Photo of a barcode").setInputFiles({ name: "cd.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo, "base64") });
  const review = page.getByRole("form", { name: "Review scanned CD" });
  await expect(review).toContainText("No MusicBrainz release lists this barcode");
  expect(lookups).toEqual([{ code: EAN, source: "photo", retry: false }]);
  await review.getByRole("button", { name: "Enter details" }).click();
  await expect(page.getByRole("textbox", { name: "Barcode", exact: true })).toHaveValue(EAN);
});
