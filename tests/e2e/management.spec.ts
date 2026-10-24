import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { LibraryData } from "../../src/domain/library.ts";

const prefix = "Stage3 browser ";
async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
}
async function add(page: Page, mobile: boolean) {
  await page
    .getByRole("button", {
      name: mobile ? "Add" : "Add to collection",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function open(page: Page, title: string) {
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .fill(title);
  await page
    .getByRole("button", { name: `Open ${title}`, exact: true })
    .click();
}
async function saved(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
}

test.afterEach(async ({ page, baseURL }) => {
  const response = await page.request.get("/api/library");
  if (!response.ok()) return;
  const library = (await response.json()) as LibraryData;
  const headers = {
    Origin: new URL(baseURL!).origin,
    "X-Strawby-Request": "1",
  };
  for (const entry of library.entries.filter((entry) =>
    entry.title.startsWith(prefix),
  ))
    for (const copy of entry.copies) {
      const current = await page.request.get(`/api/items/${copy.id}`);
      if (current.ok()) {
        const { version } = await current.json();
        const deleted = await page.request.delete(`/api/items/${copy.id}`, {
          headers,
          data: { version, confirmed: true },
        });
        expect(deleted.ok()).toBe(true);
      }
    }
});

test("manga add, metadata failure, edit, duplicate and confirmed delete persist across reloads", async ({
  page,
}, info) => {
  const title = `${prefix}manga ${info.project.name}`;
  await ready(page);
  await add(page, info.project.name === "mobile");
  await page.getByLabel("Series title", { exact: true }).fill(title);
  await page.getByLabel("Authors", { exact: true }).fill("Browser Author");
  await page.getByLabel("Volume", { exact: true }).fill("2");
  await page.getByLabel("Edition language").selectOption("JP");
  await page.getByLabel("Publisher", { exact: true }).fill("Browser Publisher");
  await page.getByLabel("Acquisition date", { exact: true }).fill("2024-02-29");
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("gift from sammy at kinokuniya");
  await page.route("**/api/metadata", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        candidates: [],
        warnings: ["The provider timed out. Manual entry is available."],
      }),
    }),
  );
  await page.getByText("Find metadata & artwork", { exact: true }).click();
  await page
    .getByRole("button", { name: "Find metadata", exact: true })
    .click();
  await expect(
    page.getByText("The provider timed out. Manual entry is available."),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Add copy", exact: true }).click();
  await saved(page);
  await open(page, title);
  await expect(page.locator(".volume-list")).toContainText("2024-02-29");
  await expect(page.locator(".volume-list")).toContainText("Gifts from Sammy");
  await page
    .getByRole("button", { name: "Edit volume 2 · JP", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Notes", exact: true }),
  ).toHaveValue("gift from sammy at kinokuniya");
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Edited manga memory");
  await page.getByLabel("Classify memory tags from notes").uncheck();
  await page.getByLabel("Memory tags", { exact: true }).fill("My manual tag");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await saved(page);
  await open(page, title);
  await expect(page.locator(".volume-list")).toContainText(
    "Edited manga memory",
  );
  await page
    .getByRole("button", { name: "Add another copy", exact: true })
    .click();
  await page.getByLabel("Volume", { exact: true }).fill("2");
  await page.getByLabel("Edition language").selectOption("JP");
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Duplicate physical copy");
  await page.getByRole("button", { name: "Add copy", exact: true }).click();
  await saved(page);
  await open(page, title);
  await expect(page.locator(".volume-list>li")).toHaveCount(2);
  await page
    .locator(".volume-list>li")
    .filter({ hasText: "Edited manga memory" })
    .getByRole("button")
    .click();
  await page.getByRole("button", { name: "Delete copy", exact: true }).click();
  await page.getByRole("button", { name: "Keep copy", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Delete copy", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await saved(page);
  await open(page, title);
  await expect(page.locator(".volume-list>li")).toHaveCount(1);
  await expect(page.locator(".volume-list")).toContainText(
    "Duplicate physical copy",
  );
  await page
    .getByRole("button", { name: "Edit volume 2 · JP", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete copy", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await saved(page);
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .fill(title);
  await expect(
    page.getByRole("heading", { name: "No matching titles" }),
  ).toBeVisible();
});

test("CD add, multi-disc tracks, manual corrections, label/year filters and delete persist", async ({
  page,
}, info) => {
  const title = `${prefix}CD ${info.project.name}`;
  await ready(page);
  await add(page, info.project.name === "mobile");
  await page
    .getByRole("combobox", { name: "Copy media type", exact: true })
    .selectOption("cd");
  await page.getByLabel("Album title", { exact: true }).fill(title);
  await page.getByLabel("Artists", { exact: true }).fill("Browser Artist");
  await page.getByLabel("Edition name").fill("Limited CD and concert");
  await page.getByLabel("Release date", { exact: true }).fill("2024");
  await page.getByRole("button", { name: "Add label", exact: true }).click();
  await page.getByLabel("Label 1", { exact: true }).fill("Browser Label");
  await page
    .getByLabel("Catalog number 1", { exact: true })
    .fill("BROWSER-123");
  await page
    .getByRole("button", { name: "Add track to disc 1", exact: true })
    .click();
  await page.getByLabel("Track 1.1", { exact: true }).fill("Opening song");
  await page.getByRole("button", { name: "Add disc", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Disc 2 format", exact: true })
    .selectOption("Blu-ray");
  await page
    .getByRole("button", { name: "Add track to disc 2", exact: true })
    .click();
  await page.getByLabel("Track 2.1", { exact: true }).fill("Concert");
  await page.getByLabel("Acquisition date", { exact: true }).fill("2025-03-04");
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Korea trip gift");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Add copy", exact: true }).click();
  await saved(page);
  await open(page, title);
  await expect(page.getByRole("dialog")).toContainText("BROWSER-123");
  await expect(page.locator(".tracklist")).toContainText("Opening song");
  await expect(page.locator(".tracklist")).toContainText("Concert");
  await page.getByRole("button", { name: "Edit CD copy", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Disc 2 format", exact: true }),
  ).toHaveValue("Blu-ray");
  await page.getByLabel("Track 1.1", { exact: true }).fill("Corrected opening");
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Corrected CD memory");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page
    .getByRole("combobox", { name: "Publisher or label", exact: true })
    .selectOption("Browser Label");
  await page
    .getByRole("combobox", { name: "Acquisition year", exact: true })
    .selectOption("2025");
  await page
    .getByRole("combobox", { name: "Edition or format", exact: true })
    .selectOption("Blu-ray");
  await page.getByRole("button", { name: "Show 1 title", exact: true }).click();
  await page.reload();
  await expect(page.locator(".entry-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: `Open ${title}`, exact: true })
    .click();
  await expect(page.locator(".tracklist")).toContainText("Corrected opening");
  await expect(page.getByRole("dialog")).toContainText("Corrected CD memory");
  await page.getByRole("button", { name: "Edit CD copy", exact: true }).click();
  await page.getByRole("button", { name: "Delete copy", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await saved(page);
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .fill(title);
  await expect(
    page.getByRole("heading", { name: "No matching titles" }),
  ).toBeVisible();
});

test("import preview, duplicate prevention, export and same-origin mutation checks work through the application", async ({
  page,
  baseURL,
}, info) => {
  const title = `${prefix}import ${info.project.name} ${Date.now()}`;
  await ready(page);
  const denied = await page.request.post("/api/items", {
    data: {
      item: { kind: "manga", title: "Unauthorized" },
      requestId: crypto.randomUUID(),
    },
  });
  expect(denied.status()).toBe(403);
  const crossOrigin = await page.request.post("/api/items", {
    headers: { Origin: "https://evil.example", "X-Strawby-Request": "1" },
    data: {},
  });
  expect(crossOrigin.status()).toBe(403);
  const csv = `Title,Volume,Author,Publisher,Date Acquired,Notes,Language\n${title},1,Import author,Import publisher,10/23/2026,Imported memory,KR\n${title},2,Import author,Import publisher,,Unknown acquisition,KR`;
  const file = {
    name: "manga.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  };
  await page
    .getByRole("button", { name: "Import & export", exact: true })
    .click();
  await page.getByLabel("Import file", { exact: true }).setInputFiles(file);
  await page
    .getByRole("button", { name: "Validate & preview", exact: true })
    .click();
  await expect(
    page.getByText("2 records; 0 duplicate candidates; 0 invalid records."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Commit import", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("I reviewed this preview and want to import it")
    .check();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Commit import", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "2 copies imported",
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await open(page, title);
  await expect(page.locator(".volume-list>li")).toHaveCount(2);
  await expect(page.locator(".volume-list")).toContainText(
    "Acquisition date unknown",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Import & export", exact: true })
    .click();
  await page.getByLabel("Import file", { exact: true }).setInputFiles(file);
  await page
    .getByRole("button", { name: "Validate & preview", exact: true })
    .click();
  await expect(
    page.getByText("2 records; 2 duplicate candidates; 0 invalid records."),
  ).toBeVisible();
  await page
    .getByLabel("I reviewed this preview and want to import it")
    .check();
  await page
    .getByRole("button", { name: "Commit import", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "0 copies imported",
  );
  const backupResponse = await page.request.get("/api/export");
  expect(backupResponse.ok()).toBe(true);
  const backup = await backupResponse.json();
  expect(backup.format).toBe("strawby-collection");
  expect(
    backup.tables.collection_items.some(
      (item: { notes: string }) => item.notes === "Imported memory",
    ),
  ).toBe(true);
  const exported = await page.request.get("/api/export?kind=manga");
  expect(exported.ok()).toBe(true);
  expect(await exported.text()).toContain(title);
  const headers = {
    Origin: new URL(baseURL!).origin,
    "X-Strawby-Request": "1",
  };
  const preview = await page.request.post("/api/imports", {
    headers,
    data: {
      kind: "json",
      filename: "backup.json",
      text: JSON.stringify(backup),
    },
  });
  expect(preview.ok()).toBe(true);
  const { token } = await preview.json();
  const restored = await page.request.put("/api/imports", {
    headers,
    data: { token, includeDuplicates: false, confirmed: true },
  });
  expect(restored.ok()).toBe(true);
  expect((await restored.json()).added).toBe(0);
});

test("a stale edit from another session is rejected with the draft kept for recovery", async ({
  page,
  baseURL,
}, info) => {
  const title = `${prefix}stale ${info.project.name} ${Date.now()}`;
  const headers = {
    Origin: new URL(baseURL!).origin,
    "X-Strawby-Request": "1",
  };
  await ready(page);
  const created = await page.request.post("/api/items", {
    headers,
    data: {
      item: { kind: "manga", title, volume: "1", notes: "Original memory" },
      requestId: crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await page.reload();
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await open(page, title);
  await page
    .getByRole("button", { name: "Edit volume 1 · EN", exact: true })
    .click();
  const notes = page.getByRole("textbox", { name: "Notes", exact: true });
  await expect(notes).toHaveValue("Original memory");
  await notes.fill("Browser draft");

  // Another session saves first.
  const current = await page.request.get(`/api/items/${id}`);
  const { item, version } = await current.json();
  const other = await page.request.put(`/api/items/${id}`, {
    headers,
    data: { item: { ...item, notes: "Other session edit" }, version },
  });
  expect(other.ok()).toBe(true);

  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "changed in another session",
  );
  await expect(notes).toHaveValue("Browser draft");
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await open(page, title);
  await expect(page.locator(".volume-list")).toContainText(
    "Other session edit",
  );
  await expect(page.locator(".volume-list")).not.toContainText("Browser draft");
});

test("loaded artwork replaces the typographic cover in the same space; failed artwork keeps it", async ({
  page,
  baseURL,
}, info) => {
  const title = `${prefix}artwork ${info.project.name} ${Date.now()}`;
  const headers = {
    Origin: new URL(baseURL!).origin,
    "X-Strawby-Request": "1",
  };
  // A 2x3 PNG stands in for a provider cover; the second URL always fails.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEklEQVR4nGNgYGBgYGBgYGAAAAAOAAFJ9fKzAAAAAElFTkSuQmCC",
    "base64",
  );
  await page.route("https://example.com/strawby-cover.png", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
  await page.route("https://example.com/strawby-missing.png", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  for (const [suffix, url] of [
    ["loaded", "https://example.com/strawby-cover.png"],
    ["missing", "https://example.com/strawby-missing.png"],
  ])
    expect(
      (
        await page.request.post("/api/items", {
          headers,
          data: {
            item: {
              kind: "manga",
              title: `${title} ${suffix}`,
              artwork: { url, scope: "edition" },
            },
            requestId: crypto.randomUUID(),
          },
        })
      ).status(),
    ).toBe(201);
  await ready(page);
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .fill(title);
  const card = (suffix: string) =>
    page
      .getByRole("button", { name: `Open ${title} ${suffix}`, exact: true })
      .locator(".media-art");
  const loaded = card("loaded");
  await expect(loaded).toHaveClass(/has-artwork/);
  await expect(loaded.locator(".cover-print")).toBeHidden();
  const [frame, image] = await Promise.all([
    loaded.boundingBox(),
    loaded.locator(".resolved-artwork").boundingBox(),
  ]);
  expect(image!.width).toBeCloseTo(frame!.width, 0);
  expect(image!.height).toBeCloseTo(frame!.height, 0);
  const missing = card("missing");
  await expect(missing.locator(".cover-print")).toBeVisible();
  await expect(missing).not.toHaveClass(/has-artwork/);
  await expect(missing.locator(".resolved-artwork")).toHaveCount(0);
});

test("books have their own add flow, lookup, tab, detail and author shelf; light novels are badged and filterable", async ({
  page,
  baseURL,
}, info) => {
  const book = `${prefix}Project Hail Mary ${info.project.name}`;
  const novel = `${prefix}light novel ${info.project.name}`;
  const headers = {
    Origin: new URL(baseURL!).origin,
    "X-Strawby-Request": "1",
  };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEklEQVR4nGNgYGBgYGBgYGAAAAAOAAFJ9fKzAAAAAElFTkSuQmCC",
    "base64",
  );
  await page.route("https://example.com/strawby-book.png", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
  let lookup: Record<string, unknown> = {};
  await page.route("**/api/metadata", async (route) => {
    lookup = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        candidates: [
          {
            id: "/books/OL4M",
            provider: "openlibrary",
            title: "Project Hail Mary",
            subtitle: "Andy Weir · Ballantine Books · Open Library edition",
            sourceUrl: "https://openlibrary.org/books/OL4M",
            detail: false,
            patch: {
              authors: ["Andy Weir"],
              publisher: "Ballantine Books",
              artwork: {
                url: "https://example.com/strawby-book.png",
                provider: "manual",
                sourceId: "",
                scope: "edition",
                attribution: "Open Library edition",
                language: "EN",
              },
            },
            warning: "Confirm it against your copy.",
          },
        ],
        warnings: [],
      }),
    });
  });
  expect(
    (
      await page.request.post("/api/items", {
        headers,
        data: {
          item: {
            kind: "manga",
            medium: "light_novel",
            title: novel,
            volume: "3",
          },
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(201);

  await ready(page);
  await add(page, info.project.name === "mobile");
  await page.getByLabel("Copy media type").selectOption("book");
  await page.getByLabel("Title", { exact: true }).fill(book);
  await page.getByText("Find metadata & artwork", { exact: true }).click();
  await page
    .getByRole("button", { name: "Find metadata", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use these details", exact: true })
    .click();
  expect(lookup).toMatchObject({ kind: "manga", medium: "book" });
  await expect(page.getByLabel("Authors", { exact: true })).toHaveValue(
    "Andy Weir",
  );
  await page.getByRole("button", { name: "Add copy", exact: true }).click();
  await saved(page);

  // Books tab, card, detail drawer without volume numbering.
  await page.getByRole("button", { name: /^Books/ }).click();
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .fill(book);
  const card = page.locator("[data-entry-kind=book]");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Andy Weir");
  await expect(card).toContainText("1 book");
  await expect(card.locator(".media-art")).toHaveClass(/has-artwork/);
  await page.getByRole("button", { name: `Open ${book}`, exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Copies" })).toBeVisible();
  await expect(drawer.locator(".volume-number")).toHaveCount(0);
  await expect(drawer.getByText("Find missing volumes")).toHaveCount(0);
  await expect(
    drawer.getByRole("button", { name: "Edit copy · EN" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page
    .getByRole("button", { name: "Virtual shelf view", exact: true })
    .click();
  const shelf = page.getByRole("region", { name: "Books by author" });
  await expect(
    shelf.getByRole("button", { name: `Open ${book} by Andy Weir, book, EN` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cover grid view", exact: true })
    .click();

  // Light novels stay in Manga with a badge and a type filter.
  await page.getByRole("button", { name: /^Manga/ }).click();
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .fill(novel);
  await expect(page.locator("[data-entry-kind=manga]")).toContainText("LN");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("Manga type").selectOption("manga");
  await expect(
    page.getByRole("button", { name: "Show 0 titles", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Manga type").selectOption("light_novel");
  await page.getByRole("button", { name: "Show 1 title", exact: true }).click();
  await page
    .getByRole("button", { name: `Open ${novel}`, exact: true })
    .click();
  await expect(page.getByRole("dialog").locator(".badge-medium")).toHaveText(
    "Light novel",
  );
  // Scan after the drawer's opening transition has settled.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished)),
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
