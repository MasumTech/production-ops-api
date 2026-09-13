import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1536, height: 1024 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  test(`login matches the approved ${viewport.name} layout`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath(`login-${viewport.name}.png`),
      fullPage: true,
      animations: "disabled",
    });

    if (viewport.name === "desktop" || viewport.name === "tablet") {
      await expect(page.getByRole("heading", { name: "Operations Control Board" })).toBeVisible();
    } else {
      await expect(page.locator(".login-brand-panel")).toBeHidden();
    }

  });
}
