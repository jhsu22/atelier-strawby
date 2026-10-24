import { test, expect } from "@playwright/test";

test.skip(process.env.STRAWBY_TEST_READ_ONLY === "true", "Uses the explicit local owner test mode.");

test("owner editing entry point renders the shelf and management controls", async ({ page }) => {
  await page.goto("/edit");
  await expect(page.locator(".library-app")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByRole("link", { name: "Public view", exact: true })).toHaveAttribute("href", "/");
  await expect(page.getByRole("button", { name: "Import & export", exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "Add to collection", exact: true });
  if (await add.isVisible()) await add.click();
  else await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add to collection" })).toBeVisible();
});
