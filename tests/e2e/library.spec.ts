import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const hydrated = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
};
async function settledPanel(page: import("@playwright/test").Page) {
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
}

test("real seeded shelf, grid densities, media switching and zero horizontal overflow", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await hydrated(page);
  await expect(page.locator(".entry-card")).toHaveCount(42);
  await expect(page.locator(".collection-inventory")).toContainText("177");
  await expect(page.locator(".collection-inventory")).toContainText("38");
  await page.getByRole("button", { name: "Manga 38", exact: true }).click();
  await expect(page.locator(".entry-card")).toHaveCount(38);
  await page.getByRole("button", { name: "CDs 4", exact: true }).click();
  await expect(page.locator(".entry-card")).toHaveCount(4);
  await page.getByRole("button", { name: "All media 42", exact: true }).click();
  for (const width of info.project.name === "mobile"
    ? [320, 360, 390, 540, 650]
    : [651, 768, 900, 901, 1024, 1280, 1440, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () =>
        document.documentElement.scrollWidth <=
        (visualViewport?.width ?? innerWidth),
      ),
    ).toBe(true);
    const count = await page
      .locator(".cover-grid")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      );
    expect(count).toBe(
      width < 480
        ? 2
        : width <= 650
          ? 3
          : width <= 900
            ? 4
            : width <= 1150
              ? 5
              : width < 1500
                ? 6
                : 7,
    );
    if (width <= 900) {
      const navigation = page.getByRole("navigation", {
        name: "Mobile navigation",
      });
      await expect(navigation).toBeVisible();
      await expect(navigation.getByRole("button")).toHaveCount(5);
    } else {
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

test("search, filter combinations, empty results and URL state survive refresh and history", async ({
  page,
}) => {
  await hydrated(page);
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .fill("A Sign of Affection");
  await expect(page.locator(".entry-card")).toHaveCount(1);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("JP");
  await page.getByRole("button", { name: "Show 1 title", exact: true }).click();
  await page.reload();
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search your collection" }),
  ).toHaveValue("A Sign of Affection");
  await expect(page.locator(".entry-card")).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("language")).toBe("JP");
  await page
    .getByRole("button", { name: "Clear search & filters", exact: true })
    .click();
  await page.getByRole("button", { name: "Manga 38", exact: true }).click();
  await page.getByRole("button", { name: "CDs 4", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Manga 38", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .fill("nothing-matches-this-title");
  await expect(
    page.getByRole("heading", { name: "No matching titles" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show the collection", exact: true })
    .click();
  await expect(page.locator(".entry-card")).toHaveCount(38);
});

test("manga drawer has language-separated copies, gaps, duplicates, notes and deep links", async ({
  page,
}) => {
  await hydrated(page);
  await page
    .getByRole("button", { name: "Open A Sign of Affection", exact: true })
    .click();
  await settledPanel(page);
  await expect(page.locator(".volume-list>li")).toHaveCount(10);
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("KR");
  await expect(page.locator(".volume-list>li")).toHaveCount(1);
  await expect(page.locator(".volume-list")).toContainText(
    "A Sign of Affection (KR)",
  );
  await page.reload();
  await settledPanel(page);
  await expect(page.getByRole("dialog")).toContainText("10 owned copies");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Open 86: EIGHTY-SIX", exact: true })
    .click();
  await page.getByLabel("Find missing volumes").check();
  await expect(page.locator(".gap-report")).toContainText("5–6");
  await page.getByRole("button", { name: "Close panel" }).click();
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .fill("The Guy She Was Interested");
  await page.locator(".entry-open").click();
  await expect(page.locator(".volume-list>li")).toHaveCount(3);
  await expect(page.locator(".volume-number strong")).toHaveText([
    "01",
    "01",
    "02",
  ]);
  await expect(page.locator(".volume-list")).toContainText(
    "Acquisition date unknown",
  );
});

test("individual spine view preserves browsing state and opens detail", async ({
  page,
}) => {
  await hydrated(page);
  await page
    .getByRole("button", { name: "Virtual shelf view", exact: true })
    .click();
  await expect(page.locator(".media-spine")).toHaveCount(181);
  await expect(page.locator(".cd-spine")).toHaveCount(4);
  // CDs share one shelf ordered by artist; unknown artists come last.
  const cdShelf = page.getByRole("region", { name: "CDs by artist" });
  await expect(cdShelf).toHaveCount(1);
  await expect(cdShelf.locator(".cd-spine")).toHaveCount(4);
  expect(
    await cdShelf
      .locator(".cd-spine")
      .evaluateAll((spines) =>
        spines.map((spine) => spine.getAttribute("aria-label")),
      ),
  ).toEqual([
    "Open Kessoku Band by Kessoku Band, CD",
    "Open Your Name OST by RADWIMPS, CD",
    "Open Susumu Hirasawa (album unresolved) by Susumu Hirasawa, CD",
    "Open Evangelion Finally, CD",
  ]);
  await expect(page.locator(".spine-shelf")).toHaveCount(39);
  // Measure and scan after the shelves' entrance animation has settled.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished)),
  );
  expect(
    await page
      .locator(".media-spine:not(.cd-spine)")
      .evaluateAll((spines) => [
        ...new Set(spines.map((spine) => spine.getBoundingClientRect().height)),
      ]),
  ).toEqual([235]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        (visualViewport?.width ?? innerWidth),
    ),
  ).toBe(true);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .fill("A Sign of Affection");
  await expect(page.locator(".media-spine")).toHaveCount(10);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("JP");
  await page.getByRole("button", { name: "Show 1 title", exact: true }).click();
  await expect(page.locator(".media-spine")).toHaveCount(1);
  await page.locator(".media-spine").first().click();
  await expect(page.getByRole("dialog")).toContainText("10 owned copies");
  await page.getByRole("button", { name: "Close panel" }).click();
  await page
    .getByRole("button", { name: "Cover grid view", exact: true })
    .click();
  await expect(page.locator(".entry-card")).toHaveCount(1);
});

test("CD drawer opens its case and honestly shows unknown release data", async ({
  page,
}, info) => {
  await hydrated(page);
  await page.getByRole("button", { name: "CDs 4", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "Open Evangelion Finally", exact: true })
      .locator(".card-credit"),
  ).toHaveText("Artist unresolved");
  await page
    .getByRole("button", { name: "Open Kessoku Band", exact: true })
    .click();
  await settledPanel(page);
  await expect(page.getByRole("dialog")).toContainText("Unknown");
  await expect(page.getByRole("dialog")).toContainText("Unresolved");
  await expect(page.getByRole("dialog")).toContainText(
    "Tracklist unavailable.",
  );
  await page
    .getByRole("button", { name: "Open jewel case", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Close jewel case", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator(".case-lid").evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  for (const width of info.project.name === "mobile" ? [320, 390] : [1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await page.locator(".case-lid").evaluate((element) => {
      const lid = element.getBoundingClientRect();
      const panel = element.closest("dialog")!.getBoundingClientRect();
      return { left: lid.left - panel.left, right: panel.right - lid.right };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeGreaterThanOrEqual(0);
  }
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
});

test("dialogs trap keyboard focus, Escape restores it, and all navigation actions respond", async ({
  page,
}, info) => {
  await hydrated(page);
  const trigger = page.getByRole("button", {
    name: "Open A Sign of Affection",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await settledPanel(page);
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press("Tab");
    expect(
      await page
        .getByRole("dialog")
        .evaluate((element) => element.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  if (info.project.name === "mobile") {
    const nav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(nav.getByRole("button")).toHaveCount(5);
    await nav
      .getByRole("button", { name: "Search & Filter", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(
      "Search & filter",
    );
    await page.keyboard.press("Escape");
    await nav
      .getByRole("button", { name: "Haul Timeline", exact: true })
      .click();
    await expect(page.locator(".haul-card")).toHaveCount(56);
    await page.keyboard.press("Escape");
    await nav.getByRole("button", { name: "Stats", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("177");
    await page.keyboard.press("Escape");
    await nav.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Add copy", exact: true }),
    ).toBeVisible();
  } else {
    await page
      .getByRole("button", { name: "Collection stats", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("177");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Add to collection", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add copy", exact: true }),
    ).toBeVisible();
  }
});

test("refresh exposes a real skeleton, preserves data on failure and recovers", async ({
  page,
}) => {
  await hydrated(page);
  await page.route("**/api/library/owner", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page
    .getByRole("button", { name: "Refresh collection", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Refreshing collection", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("could not be refreshed");
  await expect(page.locator(".entry-card")).toHaveCount(42);
  await page.unroute("**/api/library/owner");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".entry-card")).toHaveCount(42);
  const response = await page.request.get("/api/library");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});

test("light/dark themes persist, reduced motion applies, and key screens pass accessibility scans", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await hydrated(page);
  let audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({
    path: `data/generated/stage2-${info.project.name}-light.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await page.reload();
  await expect(page.locator("[data-hydrated=true]")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({
    path: `data/generated/stage2-${info.project.name}-dark.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open A Sign of Affection", exact: true })
    .click();
  await settledPanel(page);
  const duration = await page
    .getByRole("dialog")
    .evaluate((element) => getComputedStyle(element).animationDuration);
  expect(parseFloat(duration)).toBeLessThanOrEqual(0.001);
  audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({
    path: `data/generated/stage2-${info.project.name}-detail.png`,
  });
});

test("missing detail and empty API refresh are honest states", async ({
  page,
}) => {
  await page.goto("/?item=not-an-item");
  await settledPanel(page);
  await expect(page.getByRole("dialog")).toContainText("could not be found");
  await page
    .getByRole("button", { name: "Back to the shelf", exact: true })
    .click();
  await page.route("**/api/library/owner", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"entries":[]}',
    }),
  );
  await page
    .getByRole("button", { name: "Refresh collection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Collection is empty" }),
  ).toBeVisible();
});

test("drawer backdrop dismissal and mobile sheet gestures preserve usable scrolling", async ({
  page,
}, info) => {
  await hydrated(page);
  const trigger = page.getByRole("button", {
    name: "Open A Sign of Affection",
    exact: true,
  });
  await trigger.click();
  await settledPanel(page);
  if (info.project.name === "mobile") {
    const cdp = await page.context().newCDPSession(page);
    const header = (await page.locator(".drawer-top").boundingBox())!;
    const x = header.x + header.width / 2,
      y = header.y + 28;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (const offset of [25, 50, 80, 110, 140]) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + offset }],
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await settledPanel(page);
    const drawer = page.getByRole("dialog");
    const rect = (await drawer.boundingBox())!;
    const bodyY = rect.y + rect.height - 110;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: bodyY }],
    });
    for (const offset of [30, 60, 90, 120, 160]) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: bodyY - offset }],
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(drawer).toBeVisible();
    await expect
      .poll(() => drawer.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await cdp.detach();
  } else {
    await page.mouse.click(20, 180);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("CD detail renders populated release fields and an ordered multi-disc tracklist", async ({
  page,
}) => {
  await hydrated(page);
  const response = await page.request.get("/api/library/owner");
  const data = await response.json();
  const album = data.entries.find(
    (entry: { title: string }) => entry.title === "Kessoku Band",
  );
  // Explicit synthetic UI fixture; no real D1 data or release facts are changed.
  Object.assign(album, {
    releaseDate: "2001-05-06",
    formats: ["CD", "DVD"],
    labels: ["Synthetic audit label"],
    catalogNumbers: ["TEST-0001"],
    tracks: [
      {
        medium: 1,
        position: 1,
        title: "Synthetic opening",
        durationMs: 125000,
      },
      {
        medium: 1,
        position: 2,
        title: "Synthetic interlude",
        durationMs: null,
      },
      { medium: 2, position: 1, title: "Synthetic encore", durationMs: 61000 },
    ],
  });
  await page.route("**/api/library/owner", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh collection", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Refreshing collection", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "CDs 4", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Kessoku Band", exact: true })
    .click();
  await settledPanel(page);
  await expect(page.locator(".release-metadata")).toContainText("2001");
  await expect(page.locator(".release-metadata")).toContainText("CD + DVD");
  await expect(page.locator(".release-metadata")).toContainText(
    "Synthetic audit label",
  );
  await expect(page.locator(".release-metadata")).toContainText("TEST-0001");
  await expect(page.locator(".tracklist li > span:nth-child(2)")).toHaveText([
    "Synthetic opening",
    "Synthetic interlude",
    "Synthetic encore",
  ]);
  await expect(page.locator(".tracklist li > span:last-child")).toHaveText([
    "2:05",
    "—",
    "1:01",
  ]);
});
