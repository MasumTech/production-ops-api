import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1536, height: 1024 },
  { name: "wide-desktop", width: 1887, height: 852 },
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

    if (viewport.name !== "phone") {
      await expect(page.getByRole("heading", { name: "Operations Control Board" })).toBeVisible();
      const copyBox = await page.locator(".login-brand-copy").boundingBox();
      const illustrationBox = await page.locator(".production-illustration").boundingBox();
      expect(copyBox).not.toBeNull();
      expect(illustrationBox).not.toBeNull();
      expect(illustrationBox!.y).toBeGreaterThanOrEqual(copyBox!.y + copyBox!.height + 20);
    } else {
      await expect(page.locator(".login-brand-panel")).toBeHidden();
    }

  });
}
