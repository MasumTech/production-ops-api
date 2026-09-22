import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

const viewports = [
  { name: "desktop", width: 1536, height: 1024 },
  { name: "wide-desktop", width: 1887, height: 852 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844 },
] as const;

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signInAsManager(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(process.env.DEMO_MANAGER_USERNAME ?? "demo.manager");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Operational date").fill(operationalDate);
  await expect(page.getByRole("heading", { name: "Before-shift and live overview" })).toBeVisible();
}

for (const viewport of viewports) {
  test(`manager common shell matches the ${viewport.name} layout`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signInAsManager(page);

    await expect(page.getByText("Operations Control Board", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Shift pattern")).toHaveValue("day");
    await expect(page.getByRole("group", { name: "Data view" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Alerts/ })).toBeVisible();
    await expect(page.getByLabel(/Open profile menu/)).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath(`manager-shell-${viewport.name}.png`),
      animations: "disabled",
    });

    if (viewport.name === "phone") {
      const menuButton = page.getByRole("button", { name: "Open navigation" });
      await expect(menuButton).toHaveAttribute("aria-controls", "manager-navigation");
      await menuButton.click();
      await expect(page.locator(".manager-sidebar")).toHaveClass(/manager-sidebar--open/);
      await expect(
        page.locator("#manager-navigation").getByRole("button", { name: "Overview" }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.locator(".manager-sidebar")).not.toHaveClass(/manager-sidebar--open/);
      await expect(menuButton).toBeFocused();

      const skipLink = page.getByRole("link", { name: "Skip to main content" });
      await skipLink.focus();
      await expect(skipLink).toBeVisible();
      await skipLink.press("Enter");
      await expect(page.locator("#manager-content")).toBeFocused();

      await menuButton.click();
      await page.screenshot({
        path: testInfo.outputPath("manager-shell-phone-navigation.png"),
        animations: "disabled",
      });
    }
  });
}
