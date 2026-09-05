import { expect, test } from "@playwright/test";

const baseURL = process.env.BLUEWOLF_BASE_URL ?? "http://127.0.0.1:3000";

function collectRuntimeFailures(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  return failures;
}

test("desktop v0.9 live map, score trace and cropped timeline work", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "זאב כחול" })).toBeVisible();
  await expect(page.locator(".v09-live-map")).toBeVisible();
  await expect(page.getByText(/צבע אייקון\/נתיב = סוג רכב/)).toBeVisible();

  // Base map is a source selector; engineering is not duplicated as an overlay button.
  await expect(page.locator(".v09-map-source select")).toBeVisible();
  await expect(page.locator(".v09-map-layers button", { hasText: "מפת הנדסה" })).toHaveCount(0);

  // Score-colored trace is a real rendering mode.
  await page.locator(".v09-map-layers button", { hasText: "עקבה לפי ציון" }).click();
  await expect(page.locator(".v09-score-scale")).toBeVisible();
  await expect(page.locator(".v09-traces circle").first()).toBeVisible();

  // Both groups + all 3 series start visible.
  await expect(page.locator(".v09-timeline polyline")).toHaveCount(6);
  await page.locator(".v09-layer-legend button", { hasText: "נתיב" }).click();
  await expect(page.locator(".v09-timeline polyline")).toHaveCount(4);

  // Window genuinely crops the axis/domain.
  await page.locator(".v09-window-row button", { hasText: "30 דק׳" }).click();
  await expect(page.locator(".v09-timeline")).toContainText("18:30");
  await expect(page.locator(".v09-timeline")).toContainText("19:00");
  await expect(page.locator(".v09-timeline-legend")).toContainText("SI");
  await expect(page.locator(".v09-timeline-legend")).toContainText("SO");

  expect(failures, failures.join("\n")).toEqual([]);
});

test("desktop developer v0.9 exposes threshold diagrams, SO permutations and parametric route handles", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /מפתחים/ }).click();

  await expect(page.locator(".v09-developer")).toBeVisible();
  await expect(page.locator(".v09-counter").first()).toBeVisible();
  await expect(page.locator(".v09-permutation-grid > button").first()).toBeVisible();

  await page.locator(".v09-dev-nav button", { hasText: "ציון וספים" }).click();
  await expect(page.locator(".v09-threshold-diagram").first()).toBeVisible();
  expect(await page.locator(".v09-threshold-diagram").count()).toBeGreaterThan(5);

  await page.locator(".v09-dev-nav button", { hasText: "בנק נתיבים" }).click();
  await expect(page.locator(".v09-route-editor-map")).toBeVisible();
  await expect(page.locator(".v09-route-handles .handle.center")).toBeVisible();
  await expect(page.locator(".v09-route-handles .handle.radius")).toBeVisible();
  await expect(page.locator(".v09-route-handles .handle.angle")).toBeVisible();
  await expect(page.getByRole("button", { name: /חבר 2 לכפול/ })).toBeVisible();

  expect(failures, failures.join("\n")).toEqual([]);
});

test("investigation exports PDF UI with maps and explicit joined/left vehicle reasons", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /תחקור/ }).click();

  await expect(page.locator(".v09-retro-map")).toBeVisible();
  await expect(page.getByRole("button", { name: /PDF עם מפות/ })).toBeVisible();
  await expect(page.getByText(/רכב מצטרף:/).first()).toBeVisible();
  await expect(page.getByText(/רכב עוזב:/).first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /PDF עם מפות/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/blue-wolf-v09.*\.pdf$/);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("mobile template sheet keeps primary action reachable and page has no horizontal clipping", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL, { waitUntil: "networkidle" });

  const layout = await page.evaluate(() => ({
    direction: getComputedStyle(document.documentElement).direction || getComputedStyle(document.body).direction,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.direction).toBe("rtl");
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 4);

  await page.getByRole("button", { name: "החלפת תבנית" }).click();
  const sheet = page.locator(".v09-template-sheet");
  await expect(sheet).toBeVisible();
  const apply = sheet.getByRole("button", { name: /החל תבנית/ });
  await expect(apply).toBeVisible();
  const box = await apply.boundingBox();
  if (!box) throw new Error("apply button has no bounding box");
  expect(box.y + box.height).toBeLessThanOrEqual(844);

  await sheet.getByRole("button", { name: "ביטול" }).click();
  await page.getByRole("tab", { name: /מפתחים/ }).click();
  await expect(page.locator(".v09-developer")).toBeVisible();

  const after = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth + 4);
  expect(failures, failures.join("\n")).toEqual([]);
});
