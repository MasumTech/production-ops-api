import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

test.use({ timezoneId: "Europe/London" });

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signInAsTeamLeader(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(
    process.env.DEMO_LEADER_USERNAME ?? "demo.leader",
  );
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();
  await page.getByLabel("Operational date").fill(operationalDate);
  await expect(page.locator(".team-control-card")).toHaveCount(2);
}

test("Daily Plan matches the approved Team Leader reference", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1904, height: 900 });
  await signInAsTeamLeader(page);

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Daily Plan" }).click();

  await expect(
    page.getByRole("heading", { name: "Daily production plan" }),
  ).toBeVisible();
  await expect(page.getByText("07:00–18:00 day shift")).toBeVisible();
  await expect(page.locator(".daily-plan-card")).toHaveCount(2);

  const lineOne = page.locator(".daily-plan-card").filter({
    hasText: "Primary Filling",
  });
  const lineTwo = page.locator(".daily-plan-card").filter({
    hasText: "Secondary Packing",
  });

  await expect(lineOne.getByText("LINE 1")).toBeVisible();
  await expect(lineOne.getByText("225")).toBeVisible();
  await expect(lineOne.getByText("Salt & Pepper Chicken")).toBeVisible();
  await expect(lineOne.getByText("Sweet & Sour Chicken")).toBeVisible();
  await expect(lineOne.getByText("Vegetable Spring Rolls")).toBeVisible();
  await expect(lineOne.getByText("Break 1 · 40 minutes")).toBeVisible();
  await expect(lineOne.getByText("Break 2 · 40 minutes")).toBeVisible();

  await expect(lineTwo.getByText("LINE 2")).toBeVisible();
  await expect(lineTwo.getByText("233")).toBeVisible();
  await expect(lineTwo.getByText("Oat Drink 1L")).toBeVisible();
  await expect(lineTwo.getByText("BBQ Chicken Bites")).toBeVisible();
  await expect(lineTwo.getByText("Vegetable Mix Filling")).toBeVisible();

  await expect(
    page.getByText(/Approved production, food-safety, quality and escalation procedures remain authoritative/i),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /create|publish|edit plan/i }),
  ).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath("team-leader-daily-plan-v2-reference.png"),
    animations: "disabled",
    fullPage: false,
  });
});
