import { expect, test } from "@playwright/test";

const screenshotDir = "test-results/render-screenshots";

test("render smoke fixture captures stable screenshots", async ({ page }, testInfo) => {
  await page.goto("/?renderSmoke=1");
  await expect(page.getByTestId("render-smoke")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Render smoke" })).toBeVisible();
  await expect(page.getByText("A row highlighted")).toBeVisible();
  await expect(page.getByText("B column")).toBeVisible();
  await expect(page.getByText("Loss by iteration")).toBeVisible();
  await expect(page.getByText("Matrix product cell")).toBeVisible();
  await expect(page.getByText("Step 1 · 1 / 4")).toBeVisible();
  await expect(page.locator(".mermaid-svg svg").first()).toBeVisible();

  await page.getByRole("button", { name: "Вперед →" }).click();
  await expect(page.getByText("Step 2 · 2 / 4")).toBeVisible();

  const screenshotName = `${testInfo.project.name}.png`;
  const screenshotPath = `${screenshotDir}/${screenshotName}`;
  const screenshot = await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });
  expect(screenshot.length).toBeGreaterThan(16_000);
});
