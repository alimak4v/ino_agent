import { expect, test, type Page } from "@playwright/test";

const overlayButtons = ["Projects", "Tasks", "Terminal", "Search", "Memory", "Knowledge"] as const;

test.use({ viewport: { width: 1440, height: 900 } });

test("top-bar overlays stay inside the viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop overlay regression");
  await page.addInitScript(() => {
    window.localStorage.setItem("ino-agent:onboarding:v1", "done");
  });
  await page.goto("/");

  for (const name of overlayButtons) {
    await page.locator(`button[aria-label="${name}"]`).click();
    await expect(page.locator("aside").first()).toBeVisible();
    await expectOverlayInsideViewport(page);
    await page.getByRole("button", { name: "Close" }).first().click();
  }
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
