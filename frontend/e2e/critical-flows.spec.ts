import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signIn(page: Page, username: string) {
  await page.goto("/");
  const usernameEnvKey = `${username.toUpperCase().replaceAll(".", "_")}_USERNAME`;
  await page.getByLabel("Username").fill(process.env[usernameEnvKey] ?? username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
}

test("manager can open the daily risk briefing after secure sign-in", async ({ page }) => {
  await signIn(page, "demo.manager");

  await expect(
    page.getByRole("heading", { name: "Before-shift and live overview" }),
  ).toBeVisible();

  const workspace = page.locator('aside[aria-label="Operations Manager workspace"]');
  await expect(workspace.getByRole("button")).toHaveCount(8);
  await workspace.getByRole("button", { name: "Risk briefing" }).click();
  await expect(
    page.getByRole("heading", { name: "AI Daily Risk Briefing" }),
  ).toBeVisible();
});

test("team leader is routed to the assigned-line workspace", async ({ page }) => {
  await signIn(page, "demo.leader");

  await expect(page.getByText("LINE CONTROL ASSISTANT")).toBeVisible();
  await expect(page.getByRole("heading", { name: "My lines" })).toBeVisible();
  await page.locator('summary[aria-label="Open workspace controls"]').click();
  await page.getByLabel("Operational date").fill(
    process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04",
  );
  await page.locator('summary[aria-label="Open workspace controls"]').click();
  await expect(page.locator(".team-line-card")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "Today's product timeline 07:00 – 18:00" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Progress vs plan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Priority suggestion" })).toBeVisible();
  await expect(page.locator(".team-quick-actions button")).toHaveCount(4);

  await page.getByRole("button", { name: /min downtime/ }).first().click();
  await expect(page.getByRole("heading", { name: /Hourly downtime · Line/ })).toBeVisible();
  await expect(page.locator(".team-hourly-grid article")).toHaveCount(11);
  await expect(page.getByText("Planned breaks are excluded from recorded loss.")).toBeVisible();

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("button")).toHaveCount(5);
  await workspace.getByRole("button", { name: "Daily plan" }).click();
  await expect(
    page.getByRole("heading", { name: "Daily production plan" }),
  ).toBeVisible();
});

test("support user is routed to the scoped response queue", async ({ page }) => {
  await signIn(page, "demo.engineer");

  await expect(
    page.getByRole("heading", { name: "My response queue" }),
  ).toBeVisible();
  await expect(
    page.locator('aside[aria-label="Operational Support workspace"]'),
  ).toBeVisible();
});
