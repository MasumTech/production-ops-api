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

test("manager can open Pilot Admin after secure sign-in", async ({ page }) => {
  await signIn(page, "demo.manager");

  await expect(
    page.getByRole("heading", { name: "Live Floor priority board" }),
  ).toBeVisible();

  const workspace = page.locator('aside[aria-label="Operations Manager workspace"]');
  await workspace.getByRole("button", { name: "Pilot Admin" }).click();
  await expect(
    page.getByRole("heading", { name: "Pilot readiness" }),
  ).toBeVisible();
});

test("team leader is routed to the assigned-line workspace", async ({ page }) => {
  await signIn(page, "demo.leader");

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("button")).toHaveCount(5);
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
