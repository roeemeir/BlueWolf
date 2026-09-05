import { expect, test } from "@playwright/test";

const baseURL = process.env.BLUEWOLF_BASE_URL ?? "http://127.0.0.1:3000";

function collectRuntimeFailures(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`));
  });
  return failures;
}

test("desktop operational, investigation and developer flows hydrate without runtime errors", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "זאב כחול" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /מבצעי/ })).toBeVisible();
  await expect(page.locator(".v04-live-map")).toBeVisible();

  await page.getByRole("tab", { name: /תחקור/ }).click();
  await expect(page.locator(".v08-investigation-summary")).toBeVisible();
  await expect(page.getByText(/אירוע = רצף קבוצתיות יציב/)).toBeVisible();

  await page.getByRole("tab", { name: /מפתחים/ }).click();
  await expect(page.getByText("מצב מפתחים")).toBeVisible();
  await page.getByRole("button", { name: /בנק נתיבים/ }).click();
  await expect(page.locator(".v08-route-bank-editor")).toBeVisible();

  const firstHit = page.locator(".v08-editable-route .v08-route-hit").first();
  await expect(firstHit).toBeVisible();
  await firstHit.click({ position: { x: 4, y: 4 } });
  const firstControl = page.locator(".v08-control-point").first();
  await expect(firstControl).toBeVisible();

  const before = await firstControl.boundingBox();
  if (!before) throw new Error("route control point has no bounding box");
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 18, before.y + before.height / 2 + 10, { steps: 3 });
  await page.mouse.up();
  const after = await firstControl.boundingBox();
  if (!after) throw new Error("route control point disappeared after drag");
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(4);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("mobile RTL shell fits the viewport and keeps primary navigation usable", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "זאב כחול" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /מבצעי/ })).toBeVisible();

  const layout = await page.evaluate(() => ({
    direction: getComputedStyle(document.documentElement).direction || getComputedStyle(document.body).direction,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.direction).toBe("rtl");
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 4);

  await page.getByRole("tab", { name: /מפתחים/ }).click();
  await expect(page.getByText("מצב מפתחים")).toBeVisible();
  await page.getByRole("button", { name: /בנק נתיבים/ }).click();
  await expect(page.locator(".v08-route-bank-editor")).toBeVisible();
  await expect(page.locator(".v08-editable-route .v08-route-hit").first()).toBeVisible();

  expect(failures, failures.join("\n")).toEqual([]);
});
