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

test("Daily Plan matches the approved timeline reference", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await signInAsTeamLeader(page);

  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Daily Plan" }).click();

  await expect(
    page.getByRole("heading", { name: "Daily Plan" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Assigned-line product schedule, targets and planned breaks",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request plan change" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Filter Daily Plan by assigned line"),
  ).toHaveValue("all");
  await expect(
    page.getByLabel("Daily Plan sequence view"),
  ).toHaveValue("products");
  await expect(page.getByText("2 lines assigned")).toBeVisible();
  await expect(page.getByLabel("Shift pattern")).toContainText(
    "Day · 06:45–18:00",
  );

  await expect(
    page.getByRole("heading", { name: /Shift schedule · 06:45–18:00/ }),
  ).toBeVisible();
  await expect(page.getByText("Production", { exact: true })).toBeVisible();
  await expect(page.getByText("Planned break", { exact: true })).toBeVisible();
  await expect(page.locator(".tl-plan-v2__row")).toHaveCount(2);
  await expect(page.locator(".tl-plan-v2__block--production")).toHaveCount(6);
  await expect(page.locator(".tl-plan-v2__block--break")).toHaveCount(4);

  const lineOne = page.locator(".tl-plan-v2__row").filter({
    hasText: "Line 1",
  });
  const lineTwo = page.locator(".tl-plan-v2__row").filter({
    hasText: "Line 2",
  });
  await expect(
    lineOne.locator(".tl-plan-v2__block--production").filter({
      hasText: "Salt & Pepper Chicken",
    }),
  ).toBeVisible();
  await expect(
    lineOne.locator(".tl-plan-v2__block--production").filter({
      hasText: "Sweet & Sour Chicken",
    }),
  ).toBeVisible();
  await expect(
    lineOne.locator(".tl-plan-v2__block--production").filter({
      hasText: "Vegetable Spring Rolls",
    }),
  ).toBeVisible();
  await expect(
    lineTwo.locator(".tl-plan-v2__block--production").filter({
      hasText: "Oat Drink 1L",
    }),
  ).toBeVisible();
  await expect(
    lineTwo.locator(".tl-plan-v2__block--production").filter({
      hasText: "BBQ Chicken Bites",
    }),
  ).toBeVisible();
  await expect(
    lineTwo.locator(".tl-plan-v2__block--production").filter({
      hasText: "Vegetable Mix Filling",
    }),
  ).toBeVisible();

  const output = page.getByLabel("Output by assigned line");
  await expect(output.getByRole("heading", { name: "Output by assigned line" })).toBeVisible();
  await expect(output.getByText("8,400")).toBeVisible();
  await expect(output.getByText("6,888")).toBeVisible();
  await expect(output.getByText("6,000")).toBeVisible();
  await expect(output.getByText("4,020")).toBeVisible();
  await expect(output.getByText("82%")).toBeVisible();
  await expect(output.getByText("67%")).toBeVisible();
  await expect(
    page.getByText(
      /Published plans are read-only\. Request a change for Operations Manager review\./i,
    ),
  ).toBeVisible();

  const firstProduction = page.locator(".tl-plan-v2__block--production").first();
  await expect(firstProduction).toHaveCSS("position", "absolute");
  const blockBox = await firstProduction.boundingBox();
  const trackBox = await page.locator(".tl-plan-v2__track").first().boundingBox();
  expect(blockBox).not.toBeNull();
  expect(trackBox).not.toBeNull();
  expect(blockBox!.width).toBeLessThan(trackBox!.width);
  expect(blockBox!.height).toBeLessThanOrEqual(trackBox!.height);

  await page.screenshot({
    path: testInfo.outputPath("team-leader-daily-plan-v2-reference.png"),
    animations: "disabled",
    fullPage: false,
  });
});

test("Request plan change routes to the selected-line review workflow", async ({
  page,
}) => {
  await signInAsTeamLeader(page);
  const workspace = page.locator('aside[aria-label="Team Leader workspace"]');
  await workspace.getByRole("button", { name: "Daily Plan" }).click();

  await page.getByRole("button", { name: "Request plan change" }).click();

  await expect(
    page.getByRole("heading", { name: /Raise issue|Operational escalation/i }),
  ).toBeVisible();
  await expect(page.getByLabel("Summary")).toHaveValue(
    "Daily plan change request",
  );
});
