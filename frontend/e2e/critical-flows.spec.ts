import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

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
  await page.getByLabel("Operational date").fill(operationalDate);

  await expect(
    page.getByRole("heading", { name: "Before-shift and live overview" }),
  ).toBeVisible();

  const workspace = page.locator('aside[aria-label="Operations Manager workspace"]');
  await expect(workspace.getByRole("button")).toHaveCount(8);
  await expect(page.locator(".control-kpi")).toHaveCount(4);
  await expect(page.locator(".leader-card")).toHaveCount(3);
  await expect(page.locator(".leader-line")).toHaveCount(6);
  await expect(page.locator(".hourly-downtime-grid article")).toHaveCount(11);

  await workspace.getByRole("button", { name: "Team Leaders" }).click();
  await expect(page.locator(".manager-view-intro").getByRole("heading", { name: "Line Control" })).toBeVisible();
  await workspace.getByRole("button", { name: "Daily plans" }).click();
  await expect(page.getByRole("heading", { name: "Daily plans" })).toBeVisible();
  await workspace.getByRole("button", { name: "Materials" }).click();
  await expect(page.getByRole("heading", { name: "Actions and materials" })).toBeVisible();
  await workspace.getByRole("button", { name: "Break recovery" }).click();
  await expect(
    page.getByRole("heading", { name: "Break recovery and loss history" }),
  ).toBeVisible();
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
  await page.getByLabel("Operational date").fill(operationalDate);
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
  await expect(page.locator(".daily-plan-card")).toHaveCount(2);

  await workspace.getByRole("button", { name: "Materials" }).click();
  await expect(
    page.getByRole("heading", { name: "Product & material readiness" }),
  ).toBeVisible();
  for (const status of ["Ready", "In Process", "Short", "Held"]) {
    await expect(page.getByText(status, { exact: true }).first()).toBeVisible();
  }

  await workspace.getByRole("button", { name: "Break & recovery" }).click();
  await expect(page.getByRole("heading", { name: "Break & Recovery" })).toBeVisible();
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible();
  await expect(page.getByText("Suggested", { exact: true })).toBeVisible();

  await workspace.getByRole("button", { name: "Handover" }).click();
  await expect(page.getByRole("heading", { name: "Shift handover" })).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
});
