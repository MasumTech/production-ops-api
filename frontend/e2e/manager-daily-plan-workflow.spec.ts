import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signInAsManager(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(
    process.env.DEMO_MANAGER_USERNAME ?? "demo.manager",
  );
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Operational date").fill(operationalDate);
  await page
    .locator('aside[aria-label="Operations Manager workspace"]')
    .getByRole("button", { name: "Daily plans" })
    .click();
  await expect(page.getByRole("heading", { name: "Daily plans" })).toBeVisible();
}

test("past manager plans are a read-only historical snapshot", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signInAsManager(page);

  await expect(page.getByText("Historical snapshot", { exact: true })).toBeVisible();
  await expect(page.getByText("Read-only snapshot", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add plan block" })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("manager-daily-plan-historical-tablet.png"),
    animations: "disabled",
    fullPage: true,
  });
});

test("manager edits a current shift plan block", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date(`${operationalDate}T08:00:00Z`) });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await signInAsManager(page);

  await expect(page.getByRole("button", { name: "Add plan block" })).toBeVisible();
  const firstBlock = page.locator(".daily-plan-block--production").first();
  await firstBlock.click();
  const detail = page.getByRole("dialog", { name: /Salt & Pepper Chicken|Oat Drink 1L/ });
  const originalName = await detail.getByRole("heading").textContent();
  expect(originalName).toBeTruthy();
  await detail.getByRole("button", { name: "Edit block" }).click();

  const editor = page.getByRole("dialog", { name: "Edit plan block" });
  const productName = editor.getByLabel("Product name");
  await productName.fill(`${originalName} verified`);
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${originalName} verified`, { exact: true }).first()).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("manager-daily-plan-edit-desktop.png"),
    animations: "disabled",
    fullPage: true,
  });

  await page.getByText(`${originalName} verified`, { exact: true }).first().click();
  await page.getByRole("button", { name: "Edit block" }).click();
  await page.getByRole("dialog", { name: "Edit plan block" }).getByLabel("Product name").fill(originalName!);
  await page.getByRole("dialog", { name: "Edit plan block" }).getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(originalName!, { exact: true }).first()).toBeVisible();
});
