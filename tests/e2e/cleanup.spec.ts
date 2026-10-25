import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.skip(process.env.STRAWBY_TEST_READ_ONLY === "true", "The clean-up queue is an owner tool.");

// Test-only copies sort first ("0…"), so each queue opens on them, and are
// deleted afterwards; the seeded collection other specs count stays untouched.
const series = (project: string) => `0 Clean-up browser ${project}`;
async function create(request: APIRequestContext, origin: string, item: Record<string, unknown>) {
  const response = await request.post("/api/items", {
    headers: { Origin: origin, "X-Strawby-Request": "1" },
    data: { item: { kind: "manga", publisher: "Test House", ...item }, requestId: crypto.randomUUID() },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
async function item(page: Page, id: string) {
  return ((await (await page.request.get(`/api/items/${id}`)).json()) as { item: Record<string, unknown>; version: number });
}
const queueButton = (page: Page, name: string) => page.getByRole("group", { name: "What to review" }).getByRole("button", { name: new RegExp(`^${name}`) });
async function noOverflow(page: Page) {
  expect(await page.getByRole("dialog").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("the clean-up queue confirms editions, dates and covers one card at a time", async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  const origin = new URL(baseURL!).origin;
  const title = series(info.project.name);
  const ids = [
    await create(page.request, origin, { title, volume: "1", languageBasis: "assumed", artwork: { url: "https://covers.openlibrary.org/b/id/12345-L.jpg", provider: "openlibrary", scope: "representative" } }),
    await create(page.request, origin, { title, volume: "2", editionTitle: `${title} omnibus`, format: "unknown", numberingBasis: "source_record" }),
  ];
  try {
    await page.goto("/");
    await expect(page.locator("[data-hydrated=true]")).toBeVisible();
    await page.getByRole("button", { name: /^Clean up data/ }).click();
    const dialog = page.getByRole("dialog", { name: "Clean up data" });
    await expect(dialog).toBeVisible();
    const card = dialog.locator(".cleanup-card");

    // Language: one tap confirms the edition.
    await expect(queueButton(page, "Assumed language")).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("heading")).toHaveText(title);
    for (const width of info.project.name === "mobile" ? [320, 390] : [768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
    }
    await page.setViewportSize(info.project.use.viewport!);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
      await page.screenshot({ path: `data/generated/cleanup-language-${info.project.name}-${theme}.png` });
    }
    const languages = Number(await queueButton(page, "Assumed language").locator("strong").textContent());
    await card.getByRole("button", { name: "Japanese", exact: true }).click();
    await expect(queueButton(page, "Assumed language").locator("strong")).toHaveText(String(languages - 1));
    await expect(card.getByRole("heading")).not.toHaveText(title);
    expect((await item(page, ids[0]!)).item).toMatchObject({ language: "JP", languageBasis: "confirmed" });

    // Numbering and format.
    await queueButton(page, "Numbering or format").click();
    await expect(card.getByRole("heading")).toHaveText(title);
    await page.screenshot({ path: `data/generated/cleanup-numbering-${info.project.name}.png` });
    await card.getByLabel("Format", { exact: true }).selectOption("omnibus");
    await card.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(async () => (await item(page, ids[1]!)).item.format).toBe("omnibus");
    expect((await item(page, ids[1]!)).item.numberingBasis).toBe("printed");

    // Dates: one is entered, one is remembered as unknown.
    await queueButton(page, "Missing date").click();
    await expect(card.getByRole("heading")).toHaveText(title);
    await page.screenshot({ path: `data/generated/cleanup-date-${info.project.name}.png` });
    await card.getByLabel("Acquisition date", { exact: true }).fill("2024-02-29");
    await card.getByRole("button", { name: "Save date", exact: true }).click();
    await expect.poll(async () => (await item(page, ids[0]!)).item.acquiredOn).toBe("2024-02-29");
    await expect(card.getByRole("heading")).toHaveText(title);
    await card.getByRole("button", { name: "I don’t know", exact: true }).click();
    await expect(card.getByRole("heading")).not.toHaveText(title);
    expect((await item(page, ids[1]!)).item.acquiredOn).toBeNull();

    // A representative cover is confirmed for this volume.
    await queueButton(page, "Representative cover").click();
    await expect(card.getByRole("heading")).toHaveText(title);
    await page.screenshot({ path: `data/generated/cleanup-cover-${info.project.name}.png` });
    await card.getByRole("button", { name: "Yes, it matches", exact: true }).click();
    await expect.poll(async () => ((await item(page, ids[0]!)).item.artwork as { scope: string }).scope).toBe("edition");

    // No cover: candidates come from the server; one is picked.
    await page.route("**/api/cleanup/covers", (route) =>
      route.fulfill({
        json: {
          candidates: [{ artwork: { url: "https://covers.openlibrary.org/b/id/67890-L.jpg", scope: "edition", provider: "openlibrary", sourceId: "/books/OL1M", attribution: "Open Library", language: "EN" }, label: "Test cover · Open Library edition", exact: true }],
          warnings: [],
        },
      }),
    );
    await page.route("**/api/artwork", (route) => route.fulfill({ json: { cached: false, message: "Skipped in tests." } }));
    await queueButton(page, "No cover").click();
    await expect(card.getByRole("heading")).toHaveText(title);
    await card.getByRole("button", { name: "Find covers", exact: true }).click();
    await expect(card.getByRole("button", { name: /^Use this cover/ })).toBeVisible();
    await page.screenshot({ path: `data/generated/cleanup-covers-${info.project.name}.png` });
    await card.getByRole("button", { name: /^Use this cover: Test cover/ }).click();
    await expect.poll(async () => ((await item(page, ids[1]!)).item.artwork as { url: string } | null)?.url).toBe("https://covers.openlibrary.org/b/id/67890-L.jpg");

    // Skipping moves on without saving; the editor returns to the queue.
    const before = await card.getByRole("heading").textContent();
    await card.getByRole("button", { name: "Skip for now", exact: true }).click();
    await expect(card.getByRole("heading")).not.toHaveText(before!);
    await card.getByRole("button", { name: "Open in editor", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edit copy" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();

    // The stats caveats link back into the queue.
    await page.keyboard.press("Escape");
    if (info.project.name === "mobile") await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "Stats", exact: true }).click();
    else await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Collection stats", exact: true }).click();
    await page.getByText("How these numbers are counted", { exact: true }).click();
    await page.locator(".counting-rules").getByRole("button", { name: "Review in clean-up" }).last().click();
    await expect(dialog).toBeVisible();
    await expect(queueButton(page, "Assumed language")).toHaveAttribute("aria-pressed", "true");
  } finally {
    const headers = { Origin: origin, "X-Strawby-Request": "1" };
    for (const id of ids) {
      const current = await page.request.get(`/api/items/${id}`);
      if (!current.ok()) continue;
      const { version } = (await current.json()) as { version: number };
      expect((await page.request.delete(`/api/items/${id}`, { headers, data: { version, confirmed: true } })).ok()).toBe(true);
    }
  }
});
