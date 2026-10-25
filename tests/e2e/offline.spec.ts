import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

test.skip(process.env.STRAWBY_TEST_READ_ONLY === "true", "Uses the owner's saved shelf.");
test.use({ serviceWorkers: "allow" });

const ISBN = "9781974709946";
const title = "Offline test series";

async function stored(page: Page, cache: string, key: string) {
  return page.evaluate(async ([name, path]) => Boolean(await (await caches.open(name!)).match(path!)), [cache, key]);
}

test("the installed shelf works offline: saved page and library, search, and do I own this by recorded ISBN", async ({ page, context, baseURL }) => {
  const headers = { Origin: new URL(baseURL!).origin, "X-Strawby-Request": "1" };
  const created = await page.request.post("/api/items", { headers, data: { item: { kind: "manga", title, volume: "1", isbn13: ISBN, notes: "offline memory" }, requestId: crypto.randomUUID() } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  try {
    await page.goto("/");
    await expect(page.locator("[data-hydrated=true]")).toBeVisible();
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest-edit.webmanifest");
    const manifest = await (await page.request.get("/manifest-edit.webmanifest")).json();
    expect(manifest).toMatchObject({ start_url: "/edit", display: "standalone" });
    expect((await page.request.get("/icons/icon-512.png")).headers()["content-type"]).toContain("image/png");

    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true);
    // Now controlled: this load and a refresh store the page, library and assets.
    await page.reload();
    await expect(page.locator("[data-hydrated=true]")).toBeVisible();
    await page.getByRole("button", { name: "Refresh collection", exact: true }).click();
    await expect.poll(() => stored(page, "strawby-v1-pages", "/")).toBe(true);
    await expect.poll(() => stored(page, "strawby-v1-pages", "/api/library/owner")).toBe(true);
    const keys = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat());
    expect(keys.filter((path) => /^\/api\/(items|export|imports|scan|metadata)/.test(path))).toEqual([]);

    await context.setOffline(true);
    await page.goto(`/?item=${encodeURIComponent("not-saved")}`);
    await expect(page.locator("[data-hydrated=true]")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "You’re offline" })).toContainText("shelf saved on this device");
    await page.goto("/");
    await expect(page.locator("[data-hydrated=true]")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search your collection" }).fill(title);
    await expect(page.getByRole("button", { name: `Open ${title}`, exact: true })).toBeVisible();

    await page.getByRole("button", { name: /^(Add|Add to collection)$/ }).first().click();
    await page.getByRole("button", { name: "Do I own this?", exact: true }).click();
    const check = page.getByRole("region", { name: "Do I own this?" });
    await page.getByRole("textbox", { name: "ISBN", exact: true }).fill(ISBN);
    await page.getByRole("button", { name: "Look up", exact: true }).click();
    await expect(check.getByRole("heading", { name: "Yes, you own this." })).toBeVisible();
    await expect(check).toContainText(`${title}, vol. 1`);
    await expect(check).toContainText("answered from the shelf saved on this device");
    await expect(check).toContainText("The server couldn’t be reached");
    await expect(check.getByRole("button", { name: /Add (another|this) copy/ })).toHaveCount(0);

    await check.getByRole("button", { name: "Check another" }).click();
    await page.getByRole("textbox", { name: "ISBN", exact: true }).fill("9781975329044");
    await page.getByRole("button", { name: "Look up", exact: true }).click();
    await expect(check.getByRole("heading", { name: "Not found on this device." })).toBeVisible();
    await expect(check).toContainText("search the shelf by title");
  } finally {
    await context.setOffline(false);
    const current = await page.request.get(`/api/items/${id}`);
    if (current.ok()) await page.request.delete(`/api/items/${id}`, { headers, data: { version: (await current.json()).version, confirmed: true } });
  }
});
