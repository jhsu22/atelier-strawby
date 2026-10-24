import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { LibraryData, MangaSeries } from "../../src/domain/library.ts";

// Existing library, management, and insights suites exercise the complete browse,
// gaps, timeline, CRUD, CSV and persistence paths on desktop and mobile.
test("downloaded JSON restores a deleted copy through the UI and survives reload", async ({page, baseURL}, info) => {
  const title = `Release restore ${info.project.name}`;
  const headers = {Origin: new URL(baseURL!).origin, "X-Strawby-Request": "1"};
  const created = await page.request.post("/api/items", {headers, data: {item: {kind: "manga", title, volume: "1", notes: "A saved memory 🍓", tagsMode: "manual", tags: ["Release test"]}, requestId: crypto.randomUUID()}});
  expect(created.status()).toBe(201);
  const {id} = await created.json();
  try {
    await page.goto("/");
    await expect(page.locator("[data-hydrated=true]")).toBeVisible();
    await page.getByRole("button", {name: "Import & export", exact: true}).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", {name: "Full JSON backup", exact: true}).click();
    const download = await downloadPromise;
    const bytes = await readFile((await download.path())!);
    expect(JSON.parse(bytes.toString()).format).toBe("strawby-collection");
    const before = await (await page.request.get(`/api/items/${id}`)).json();
    expect((await page.request.delete(`/api/items/${id}`, {headers, data: {version: before.version, confirmed: true}})).ok()).toBe(true);
    expect((await page.request.get(`/api/items/${id}`)).status()).toBe(404);
    await page.getByRole("combobox", {name: "Import format", exact: true}).selectOption("json");
    await page.getByLabel("Import file", {exact: true}).setInputFiles({name: "saved-backup.json", mimeType: "application/json", buffer: bytes});
    await page.getByRole("button", {name: "Validate & preview", exact: true}).click();
    await page.getByLabel("I reviewed this preview and want to import it").check();
    await page.getByRole("button", {name: "Commit import", exact: true}).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText("1 copies imported");
    await page.reload();
    await expect(page.locator("[data-hydrated=true]")).toBeVisible();
    await page.getByRole("searchbox", {name: "Search your collection"}).fill(title);
    await page.getByRole("button", {name: `Open ${title}`, exact: true}).click();
    await expect(page.locator(".volume-list")).toContainText("A saved memory 🍓");
    const after = await (await page.request.get(`/api/items/${id}`)).json();
    expect(after.item).toEqual(before.item);
  } finally {
    const current = await page.request.get(`/api/items/${id}`);
    if (current.ok()) expect((await page.request.delete(`/api/items/${id}`, {headers, data: {version: (await current.json()).version, confirmed: true}})).ok()).toBe(true);
  }
});

test("5,000 copies across 1,000 titles remain searchable and browsable", async ({page}, info) => {
  const initial = await (await page.request.get("/api/library")).json() as LibraryData;
  const source = initial.entries.find(entry => entry.kind === "manga") as MangaSeries;
  const entries = Array.from({length: 1000}, (_, index) => ({...source, id: `large-${index}`, title: `Scale series ${String(index).padStart(4, "0")}`, copies: Array.from({length: 5}, (_, copy) => ({...source.copies[0]!, artwork: null, id: `copy-${index}-${copy}`, editionRunId: `run-${index}`, volume: String(copy + 1), volumeSort: copy + 1}))}));
  await page.goto("/");
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await page.route("**/api/library", route => route.fulfill({json: {entries}}));
  const start = Date.now();
  await page.getByRole("button", {name: "Refresh collection", exact: true}).click();
  await expect(page.locator(".entry-card")).toHaveCount(1000);
  const renderMs = Date.now() - start;
  await page.getByRole("searchbox", {name: "Search your collection"}).fill("Scale series 0999");
  await page.getByRole("button", {name: "Open Scale series 0999", exact: true}).click();
  await expect(page.locator(".volume-list > li")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach("large-library-measurement", {body: JSON.stringify({titles: 1000, copies: 5000, renderMs, payloadBytes: Buffer.byteLength(JSON.stringify({entries}))}), contentType: "application/json"});
});

test("production responses keep data private and reject malformed or cross-origin writes", async ({page, baseURL}) => {
  const response = await page.request.get("/api/library");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  const headers = {Origin: new URL(baseURL!).origin, "X-Strawby-Request": "1", "Content-Type": "application/json"};
  expect((await page.request.post("/api/items", {headers, data: Buffer.from("{broken")})).status()).toBe(400);
  expect((await page.request.post("/api/items", {headers, data: {item: {kind: "manga", title: ""}}})).status()).toBe(422);
  expect((await page.request.post("/api/items", {headers: {...headers, Origin: "https://example.com"}, data: {}})).status()).toBe(403);
});
