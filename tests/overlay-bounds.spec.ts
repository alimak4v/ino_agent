import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test("main sidebar starts closed and stays inside the viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop sidebar regression");
  await page.addInitScript(() => {
    window.localStorage.setItem("ino-agent:onboarding:v1", "done");
  });
  await page.goto("/");

  await expect(page.locator("aside")).toHaveCount(0);
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(page.locator("aside").first()).toBeVisible();
  await expectOverlayInsideViewport(page);
  await expect(page.getByRole("button", { name: "Search" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Close sidebar" })).toBeVisible();
});

async function expectOverlayInsideViewport(page: Page) {
  const box = await page.locator("aside").first().boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}
