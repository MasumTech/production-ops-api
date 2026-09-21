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
  await expect(
    page.getByRole("heading", { name: "Before-shift and live overview" }),
  ).toBeVisible();
}

test("manager confirms Operational Support access changes", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await signInAsManager(page);

  const workspace = page.locator(
    'aside[aria-label="Operations Manager workspace"]',
  );
  await workspace.getByRole("button", { name: "Pilot admin" }).click();

  await expect(
    page.getByRole("heading", { name: "Pilot readiness" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Workspace roles" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Grant Support access" })
    .first()
    .click();

  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Grant Operational Support access?");
  await expect(confirmation).toContainText(
    "view assigned and unassigned support actions and claim work",
  );
  await expect(
    confirmation.getByRole("button", { name: "Confirm grant" }),
  ).toBeVisible();

  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toBeHidden();
});
