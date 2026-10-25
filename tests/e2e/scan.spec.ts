import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installBarcodeArt, installFakeCamera } from "../helpers/barcode-art.ts";
import type { ScanLookupResult } from "../../src/domain/scan.ts";
import type { LibraryData } from "../../src/domain/library.ts";

test.skip(process.env.STRAWBY_TEST_READ_ONLY === "true", "Scanning is an owner tool.");

// Lookup answers come from the real lookup code over recorded provider
// responses and the same seeded collection the test server uses.
const ISBNS = ["9784088818313", "9781974709939", "9781975329044", "9798888771938", "9781974715466"];
const results: Record<string, ScanLookupResult> = {};
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const { lookupIsbn } = await import("../../src/server/scan/lookup.ts");
  const { replayFetcher, seededCollection } = await import("../helpers/scan-fixtures.ts");
  const db = await seededCollection();
  try {
    const fetcher = await replayFetcher();
    for (const isbn of ISBNS) results[isbn] = await lookupIsbn(db, { code: isbn, source: "camera" }, { fetcher, googleBooksKey: "synthetic-key" });
  } finally {
    await db.close();
  }
});

async function openScanner(page: Page, info: TestInfo, camera: Parameters<typeof installFakeCamera>[0] = {}, isbn?: string, mode: "Scan barcode" | "Do I own this?" | "Log a haul" = "Scan barcode") {
  await page.addInitScript(installBarcodeArt);
  await page.addInitScript(installFakeCamera, camera);
  const lookups: { code: string; source: string }[] = [];
  await page.route("**/api/scan/isbn", async (route) => {
    const body = route.request().postDataJSON() as { code: string; source: string };
    lookups.push(body);
    const result = results[body.code];
    await route.fulfill(result ? { json: result } : { status: 503, json: { error: "The operation could not be completed. Refresh and try again." } });
  });
  await page.goto("/");
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  if (isbn) await page.evaluate((code) => {
    const w = window as unknown as { __barcodeArt: { draw: (c: HTMLCanvasElement, i: string, v: string) => void }; __fakeCamera: HTMLCanvasElement };
    w.__barcodeArt.draw(w.__fakeCamera, code, "clean");
  }, isbn);
  await page.getByRole("button", { name: info.project.name === "mobile" ? "Add" : "Add to collection", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enter details", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: mode, exact: true }).click();
  return lookups;
}
async function library(page: Page) {
  return (await (await page.request.get("/api/library/owner")).json()) as LibraryData;
}
async function remove(page: Page, baseURL: string | undefined, id: string) {
  const headers = { Origin: new URL(baseURL!).origin, "X-Strawby-Request": "1" };
  const current = await page.request.get(`/api/items/${id}`);
  if (current.ok())
    expect((await page.request.delete(`/api/items/${id}`, { headers, data: { version: (await current.json()).version, confirmed: true } })).ok()).toBe(true);
}
const copiesOf = (data: LibraryData, title: string) =>
  data.entries.flatMap((entry) => (entry.kind !== "cd" && entry.title === title ? entry.copies : []));

test("live camera scan of a Japanese edition: owned series via bridge, new JP edition, editable review, saved copy", async ({ page, baseURL }, info) => {
  const lookups = await openScanner(page, info, {}, "9784088818313");
  const review = page.getByRole("form", { name: "Review scanned copy" });
  await expect(review).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished)));
  await page.screenshot({ path: `data/generated/scan-review-${info.project.name}.png` });
  expect(lookups).toEqual([{ code: "9784088818313", source: "camera", retry: false }]);
  const constraints = await page.evaluate(() => (window as unknown as { __cameraCalls: MediaStreamConstraints[] }).__cameraCalls[0]);
  expect(constraints).toMatchObject({ audio: false, video: { facingMode: { ideal: "environment" } } });
  await expect(review.getByText("ISBN 978-4088818313", { exact: false })).toBeVisible();
  await expect(review.getByRole("radio", { name: /Chainsaw Man/ })).toBeChecked();
  await expect(review.getByText("New edition of this series", { exact: false })).toBeVisible();
  await expect(review.getByRole("textbox", { name: /Series title/ })).toHaveValue("Chainsaw Man");
  await expect(review.getByRole("textbox", { name: /Volume/ })).toHaveValue("2");
  await expect(review.getByRole("combobox", { name: /Language/ })).toHaveValue("JP");
  await expect(review.locator(".scan-duplicate")).toHaveCount(0);
  // Audit settled colours, not the review's fade-in.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished)));
  const audit = await new AxeBuilder({ page }).include(".drawer").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await review.getByLabel("Acquisition date", { exact: true }).fill("2026-10-24");
  await review.getByRole("textbox", { name: "Notes" }).fill(`e2e scan ${info.project.name}`);
  await review.getByRole("button", { name: "Add to collection", exact: true }).click();
  await expect(page.getByText("Added Chainsaw Man, volume 2.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan next" })).toBeVisible();
  const saved = copiesOf(await library(page), "Chainsaw Man").find((copy) => copy.notes === `e2e scan ${info.project.name}`);
  try {
    expect(saved).toMatchObject({ language: "JP", volume: "2", editionTitle: "チェンソーマン", acquiredOn: "2026-10-24" });
    const item = (await (await page.request.get(`/api/items/${saved!.id}`)).json()) as { item: { isbn13: string } };
    expect(item.item.isbn13).toBe("9784088818313");
  } finally {
    if (saved) await remove(page, baseURL, saved.id);
  }
});

test("do I own this? answers from the shelf, saves nothing, checks the next book and can continue into adding", async ({ page }, info) => {
  const lookups = await openScanner(page, info, {}, "9781974709939", "Do I own this?");
  const before = await library(page);
  const check = page.getByRole("region", { name: "Do I own this?" });
  await expect(check.getByRole("heading", { name: "Yes, you own this." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog", { name: "Do I own this?" })).toBeVisible();
  await expect(check).toContainText("Chainsaw Man, vol. 1 · EN");
  await expect(check).toContainText("Buying it again would be a duplicate.");
  await expect(check.getByRole("button", { name: "Add another copy" })).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished)));
  await page.screenshot({ path: `data/generated/scan-check-owned-${info.project.name}.png` });
  const audit = await new AxeBuilder({ page }).include(".drawer").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // The next book: a Japanese edition of a series owned only in English.
  await page.evaluate(() => {
    const w = window as unknown as { __barcodeArt: { draw: (c: HTMLCanvasElement, i: string, v: string) => void }; __fakeCamera: HTMLCanvasElement };
    w.__barcodeArt.draw(w.__fakeCamera, "9784088818313", "clean");
  });
  await check.getByRole("button", { name: "Check another" }).click();
  await expect(check.getByRole("heading", { name: "Not this one, but you collect it." })).toBeVisible({ timeout: 15_000 });
  await expect(check).toContainText("You own this series, but not its JP edition.");
  await expect(check).toContainText(/Also owned: vols\. 1.* in EN · VIZ Media/);
  expect(lookups.map((lookup) => lookup.code)).toEqual(["9781974709939", "9784088818313"]);
  expect(JSON.stringify(await library(page))).toBe(JSON.stringify(before));

  // Adding continues into the normal review with the same lookup, no second request.
  await check.getByRole("button", { name: "Add this copy" }).click();
  const review = page.getByRole("form", { name: "Review scanned copy" });
  await expect(review.getByRole("combobox", { name: /Language/ })).toHaveValue("JP");
  await expect(review.getByRole("textbox", { name: /Volume/ })).toHaveValue("2");
  await expect(page.getByRole("dialog", { name: "Add to collection" })).toBeVisible();
  expect(lookups).toHaveLength(2);
});

test("log a haul: a range and a scanned stack save together with a shared date, store and note", async ({ page, baseURL }, info) => {
  const lookups = await openScanner(page, info, {}, "9784088818313", "Log a haul");
  await expect(page.getByRole("dialog", { name: "Log a haul" })).toBeVisible();
  const store = `E2E Books ${info.project.name}`;
  await page.getByLabel("Haul date").fill("2026-10-21");
  await page.getByRole("textbox", { name: "Store" }).fill(store);
  await page.getByRole("textbox", { name: "Haul notes" }).fill(`e2e haul ${info.project.name}`);

  const range = page.getByRole("form", { name: "Add volumes by range" });
  await range.getByRole("combobox", { name: "Series" }).selectOption({ label: "Chainsaw Man" });
  await range.getByRole("textbox", { name: "From volume" }).fill("11");
  await range.getByRole("textbox", { name: "To volume" }).fill("12");
  await range.getByRole("button", { name: "Add to haul" }).click();
  const list = page.getByRole("region", { name: "Copies in this haul" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").first()).toContainText("Already on your shelf");

  // A stack: the Japanese volume, then an owned English volume.
  await page.getByRole("button", { name: "Scan a stack of books" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(3, { timeout: 15_000 });
  await page.evaluate(() => {
    const w = window as unknown as { __barcodeArt: { draw: (c: HTMLCanvasElement, i: string, v: string) => void }; __fakeCamera: HTMLCanvasElement };
    w.__barcodeArt.draw(w.__fakeCamera, "9781974709939", "clean");
  });
  await expect(list.getByRole("listitem")).toHaveCount(4, { timeout: 15_000 });
  await expect(list.getByRole("textbox", { name: "Title for row 3" })).toHaveValue("Chainsaw Man");
  await expect(list.getByRole("listitem").nth(3)).toContainText("Already on your shelf");
  expect(lookups.map((lookup) => lookup.code)).toEqual(["9784088818313", "9781974709939"]);
  await page.getByRole("button", { name: "Stop scanning" }).click();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished)));
  await page.screenshot({ path: `data/generated/haul-logger-${info.project.name}.png`, fullPage: true });
  const audit = await new AxeBuilder({ page }).include(".drawer").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Save 4 copies as one haul" }).click();
  await expect(page.getByText("Saved 4 copies to this haul.")).toBeVisible();
  const saved = copiesOf(await library(page), "Chainsaw Man").filter((copy) => copy.haul?.store === store);
  try {
    expect(saved).toHaveLength(4);
    expect(new Set(saved.map((copy) => copy.haul!.id)).size).toBe(1);
    expect(saved.every((copy) => copy.acquiredOn === "2026-10-21" && copy.notes === `e2e haul ${info.project.name}` && copy.notesPrivate)).toBe(true);
    expect(saved.map((copy) => `${copy.language} ${copy.volume}`).sort()).toEqual(["EN 1", "EN 11", "EN 12", "JP 2"]);
    await page.goto("/?section=timeline");
    const card = page.locator(`[data-logged-haul="${saved[0]!.haul!.id}"]`);
    await expect(card).toContainText(store);
    await expect(card).toContainText("logged together");
  } finally {
    for (const copy of saved) await remove(page, baseURL, copy.id);
  }
});

test("do I own this? falls back to the saved shelf when the connection drops mid-lookup", async ({ page }, info) => {
  await openScanner(page, info, {}, "", "Do I own this?");
  await page.route("**/api/scan/isbn", (route) => route.abort("internetdisconnected"));
  await page.getByRole("textbox", { name: "ISBN or barcode", exact: true }).fill("9781975329044");
  await page.getByRole("button", { name: "Look up", exact: true }).click();
  const check = page.getByRole("region", { name: "Do I own this?" });
  await expect(check.getByRole("heading", { name: "Not found on this device." })).toBeVisible();
  await expect(check).toContainText("The server couldn’t be reached");
  await expect(check).toContainText("search the shelf by title");
});

test("do I own this? is honest when no catalog knows the ISBN", async ({ page }, info) => {
  await openScanner(page, info, {}, "9781975329044", "Do I own this?");
  const check = page.getByRole("region", { name: "Do I own this?" });
  await expect(check.getByRole("heading", { name: "No match in your collection." })).toBeVisible({ timeout: 15_000 });
  await expect(check).toContainText("couldn't be matched to a series by title");
  await expect(check.getByRole("button", { name: "Open series" })).toHaveCount(0);
});

test("an owned volume is flagged as a duplicate but can be saved as another copy", async ({ page, baseURL }, info) => {
  await openScanner(page, info, {}, "9781974709939");
  const review = page.getByRole("form", { name: "Review scanned copy" });
  await expect(review.locator(".scan-duplicate")).toContainText("You already own volume 1 of this edition", { timeout: 15_000 });
  const before = copiesOf(await library(page), "Chainsaw Man").filter((copy) => copy.volume === "1" && copy.language === "EN");
  await review.getByRole("textbox", { name: "Notes" }).fill(`e2e duplicate ${info.project.name}`);
  await review.getByRole("button", { name: "Add another copy", exact: true }).click();
  await expect(page.getByText("Added Chainsaw Man, volume 1.", { exact: false })).toBeVisible();
  const after = copiesOf(await library(page), "Chainsaw Man").filter((copy) => copy.volume === "1" && copy.language === "EN");
  const added = after.find((copy) => copy.notes === `e2e duplicate ${info.project.name}`);
  try {
    expect(after).toHaveLength(before.length + 1);
    expect(new Set(after.map((copy) => copy.editionRunId)).size).toBe(1);
  } finally {
    if (added) await remove(page, baseURL, added.id);
  }
});

test("no catalog record: fields are flagged, and picking an owned series finds the duplicate live", async ({ page }, info) => {
  await openScanner(page, info, {}, "");
  await expect(page.locator(".scanner[data-ready=true]")).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished)));
  await page.screenshot({ path: `data/generated/scan-viewfinder-${info.project.name}.png` });
  await page.evaluate(() => {
    const w = window as unknown as { __barcodeArt: { draw: (c: HTMLCanvasElement, i: string, v: string) => void }; __fakeCamera: HTMLCanvasElement };
    w.__barcodeArt.draw(w.__fakeCamera, "9781975329044", "busy-cover");
  });
  const review = page.getByRole("form", { name: "Review scanned copy" });
  await expect(review.getByText("No catalog lists this ISBN yet", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(review.getByText("Needs your input").first()).toBeVisible();
  await expect(review.getByText("The volume number was not found", { exact: false })).toBeVisible();
  await expect(review.getByText("Assumed from ISBN")).toBeVisible();
  await expect(review.locator(".scan-duplicate")).toHaveCount(0);
  await review.getByLabel("Another series I own").or(review.getByLabel("A series I own", { exact: true })).first().check();
  await review.locator("#scan-owned-series").selectOption({ label: "Girls' Last Tour" });
  await expect(review.getByRole("textbox", { name: /Series title/ })).toHaveValue("Girls' Last Tour");
  await review.getByRole("textbox", { name: /Volume/ }).fill("6");
  await expect(review.locator(".scan-duplicate")).toContainText("You already own volume 6");
  await expect(review.getByText("The volume number was not found", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: `data/generated/scan-duplicate-${info.project.name}.png`, fullPage: false });
  await review.getByRole("textbox", { name: /Volume/ }).fill("4");
  await expect(review.locator(".scan-duplicate")).toHaveCount(0);
  await expect(review.getByRole("button", { name: "Add to collection", exact: true })).toBeVisible();
});

test("an omnibus is matched to its series without being called a duplicate of volume 1; the owner can override the series", async ({ page }, info) => {
  await openScanner(page, info, {}, "9798888771938");
  const review = page.getByRole("form", { name: "Review scanned copy" });
  await expect(review.getByRole("radio", { name: /A Sign of Affection/ })).toBeChecked({ timeout: 15_000 });
  await expect(review.getByText("omnibus", { exact: false }).first()).toBeVisible();
  await expect(review.locator(".scan-duplicate")).toHaveCount(0);
  await review.getByRole("radio", { name: /A series I don’t own yet/ }).check();
  await expect(review.getByRole("textbox", { name: /Authors/ })).toBeEnabled();
  await review.getByRole("textbox", { name: /Series title/ }).fill("A Sign of Affection Omnibus");
  await expect(review.getByRole("textbox", { name: /Series title/ })).toHaveValue("A Sign of Affection Omnibus");
});

for (const [label, camera, message] of [
  ["permission denied", { fail: "NotAllowedError" }, "Camera access is blocked"],
  ["no camera", { fail: "NotFoundError" }, "No camera was found"],
  ["camera busy", { fail: "NotReadableError" }, "being used by another app"],
  ["insecure page", { insecure: true }, "secure (HTTPS) connection"],
  ["no camera API", { noMediaDevices: true }, "cannot open the camera"],
] as const) {
  test(`camera failure (${label}) explains recovery and the typed ISBN fallback still works`, async ({ page }, info) => {
    const lookups = await openScanner(page, info, camera);
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.getByText("Use a photo")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open camera" })).toBeVisible();
    await page.getByRole("textbox", { name: "ISBN or barcode", exact: true }).fill("978-1-9747-1546-7");
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByRole("alert")).toContainText("check digit");
    expect(lookups).toEqual([]);
    await page.getByRole("textbox", { name: "ISBN or barcode", exact: true }).fill("1974715469");
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByRole("form", { name: "Review scanned copy" })).toBeVisible();
    expect(lookups).toEqual([{ code: "9781974715466", source: "manual", retry: false }]);
  });
}

async function photo(page: Page, isbn: string, variant: string) {
  const data = await page.evaluate(
    ([code, kind]) => {
      const w = window as unknown as { __barcodeArt: { draw: (c: HTMLCanvasElement, i: string, v: string) => void } };
      const canvas = document.createElement("canvas");
      if (code) w.__barcodeArt.draw(canvas, code, kind!);
      else {
        canvas.width = 800;
        canvas.height = 600;
        canvas.getContext("2d")!.fillRect(100, 100, 300, 200);
      }
      return canvas.toDataURL("image/png").split(",")[1]!;
    },
    [isbn, variant],
  );
  return { name: "barcode.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") };
}

test("photo fallback decodes on the device, explains price codes and empty photos, and survives a lookup outage", async ({ page }, info) => {
  const lookups = await openScanner(page, info, { fail: "NotAllowedError" });
  const input = page.getByLabel("Photo of a barcode");
  await input.setInputFiles(await photo(page, "", ""));
  await expect(page.getByRole("alert")).toContainText("No barcode was found");
  // A price code alone is explained rather than looked up.
  await input.setInputFiles(await photo(page, "1920979005006", "clean"));
  await expect(page.getByRole("alert")).toContainText("Japanese price barcode");
  await input.setInputFiles(await photo(page, "9784999999996", "jp-two-barcodes"));
  await expect(page.getByRole("button", { name: "Retry lookup" })).toBeVisible();
  expect(lookups).toEqual([{ code: "9784999999996", source: "photo", retry: false }]);
  await page.getByRole("button", { name: "Enter details by hand" }).click();
  const review = page.getByRole("form", { name: "Review scanned copy" });
  await expect(review.getByText("could not be checked for duplicates", { exact: false })).toBeVisible();
  await expect(review.getByText("ISBN 978-4999999996", { exact: false })).toBeVisible();
  await expect(review.getByRole("combobox", { name: /Language/ })).toHaveValue("JP");
  await review.getByRole("button", { name: "Edit all fields" }).click();
  await expect(page.getByRole("textbox", { name: "ISBN", exact: true })).toHaveValue("9784999999996");
});

test("the manual editor validates and converts ISBNs", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await page.getByRole("button", { name: info.project.name === "mobile" ? "Add" : "Add to collection", exact: true }).click();
  await page.getByRole("textbox", { name: "Series title", exact: true }).fill("ISBN validation only");
  await page.getByRole("textbox", { name: "ISBN", exact: true }).fill("4065266093");
  await page.getByRole("button", { name: "Add copy", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("ISBN: That number fails the ISBN check digit");
});

test("the lookup endpoint enforces same-origin owner requests, size and type limits, and rate limits", async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "desktop", "One shared server-side window; run once.");
  const headers = { Origin: new URL(baseURL!).origin, "X-Strawby-Request": "1" };
  expect((await page.request.post("/api/scan/isbn", { data: { code: "9781974715466", source: "manual" } })).status()).toBe(403);
  expect((await page.request.post("/api/scan/isbn", { headers: { ...headers, "Content-Type": "text/plain" }, data: "9781974715466" })).status()).toBe(415);
  expect((await page.request.post("/api/scan/isbn", { headers, data: { code: "9781974715466", source: "manual", pad: "x".repeat(3000) } })).status()).toBe(413);
  const invalid = await page.request.post("/api/scan/isbn", { headers, data: { code: "9781974715467", source: "manual" } });
  expect(invalid.status()).toBe(422);
  expect((await invalid.json()).error).toContain("check digit");
  const statuses: number[] = [];
  for (let i = 0; i < 40; i++) statuses.push((await page.request.post("/api/scan/isbn", { headers, data: { code: "9781974715467", source: "manual" } })).status());
  expect(statuses).toContain(429);
  expect(statuses.indexOf(429)).toBeLessThanOrEqual(29);
  expect(statuses.slice(statuses.indexOf(429)).every((status) => status === 429)).toBe(true);
});
