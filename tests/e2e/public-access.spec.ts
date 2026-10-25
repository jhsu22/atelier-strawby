import { test, expect } from "@playwright/test";

test.skip(process.env.STRAWBY_TEST_READ_ONLY !== "true", "Uses the anonymous read-only test server.");

test("shared collection browses without login and exposes no editing controls", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator(".library-app")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByRole("heading", { name: "Collection", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Owner sign in" })).toHaveAttribute("href", "/edit");
  await expect(page.getByRole("button", { name: /Add to collection|Import & export|^Add$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Open To Your Eternity", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit |Add another copy|Find missing volumes|Search released volumes|Check more releases/ })).toHaveCount(0);
  // Seeded notes are private: neither the drawer nor the shelf data carries them.
  await expect(page.getByRole("dialog")).not.toContainText("random vromans");
  expect(await page.content()).not.toContain("random vromans");
  for (const path of ["/edit", "/api/export", "/api/imports", "/api/items/any-id", "/api/library/owner"]) {
    expect((await request.get(path)).status()).toBe(403);
  }
  for (const [path, method] of [["/api/items", "POST"], ["/api/items/any-id", "PUT"], ["/api/items/any-id", "DELETE"], ["/api/imports", "PUT"], ["/api/metadata", "POST"], ["/api/releases", "POST"], ["/api/artwork", "POST"]]) {
    const response = await request.fetch(path!, { method, headers: { origin: new URL(page.url()).origin, "x-strawby-request": "1" }, data: {} });
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toContain("collection owner");
  }
  const shelf = await request.get("/api/library");
  expect(shelf.status()).toBe(200);
  const body = await shelf.text();
  expect(body).not.toContain("random vromans");
  expect(body).not.toContain("Gifts from Sammy");
  expect(body).not.toContain("notesPrivate");
  expect((await request.get("/foundation")).status()).toBe(200);
});
