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

test("manager Day and Night selection scopes the complete workspace", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await signInAsManager(page);

  const dateControl = page.locator(".manager-header-date");
  const dateInput = page.getByLabel("Operational date");
  const controlBox = await dateControl.boundingBox();
  const inputBox = await dateInput.boundingBox();
  expect(controlBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.width).toBeCloseTo(controlBox!.width, 0);
  expect(inputBox!.height).toBeCloseTo(controlBox!.height, 0);
  await dateInput.click({
    position: { x: inputBox!.width / 2, y: inputBox!.height - 2 },
  });
  await expect(dateInput).toBeFocused();

  const summary = page.getByRole("region", { name: "Operational summary" });
  const kpis = summary.locator(".control-kpi");
  await expect(kpis.nth(0).locator("strong")).toHaveText("6");
  await expect(kpis.nth(2).locator("strong")).not.toHaveText("0%");
  await expect(page.locator(".leader-line")).toHaveCount(6);

  await page.screenshot({
    path: testInfo.outputPath("manager-shift-integrity-day.png"),
    animations: "disabled",
  });

  const nightRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("shift_type=night")) {
      nightRequests.push(request.url());
    }
  });

  await page.getByLabel("Shift pattern").selectOption("night");

  await expect(page.getByLabel("Shift pattern")).toHaveValue("night");
  await expect(page.getByText(/Night shift 23:00–07:00/)).toBeVisible();
  await expect(kpis.nth(0).locator("strong")).toHaveText("2");
  await expect(kpis.nth(1).locator("strong")).toHaveText("1");
  await expect(kpis.nth(2).locator("strong")).toHaveText("0%");
  await expect(kpis.nth(3).locator("strong")).toHaveText("0 min");
  await expect(page.locator(".leader-line")).toHaveCount(2);

  const shiftScopedEndpoints = [
    "/team-leader-assignments/",
    "/daily-plan-blocks/",
    "/break-opportunities/",
    "/break-recoveries/",
    "/hourly-line-updates/latest-status/",
    "/product-material-readiness/",
    "/operational-escalations/",
    "/shifts/",
    "/downtime-events/",
    "/dashboard/summary/",
  ];
  for (const endpoint of shiftScopedEndpoints) {
    expect(
      nightRequests.some((url) => url.includes(endpoint)),
      `${endpoint} should be reloaded for Night shift`,
    ).toBe(true);
  }

  await page.screenshot({
    path: testInfo.outputPath("manager-shift-integrity-night.png"),
    animations: "disabled",
  });

  const workspace = page.locator(
    'aside[aria-label="Operations Manager workspace"]',
  );
  await workspace.getByRole("button", { name: "Team Leaders" }).click();
  await expect(page.getByRole("button", { name: "All (2)" })).toBeVisible();
  await expect(page.locator(".manager-row")).toHaveCount(2);

  await workspace.getByRole("button", { name: "Daily plans" }).click();
  await expect(page.locator(".daily-plan-row")).toHaveCount(2);
  await expect(page.getByText("No plan blocks recorded")).toHaveCount(2);

  await workspace.getByRole("button", { name: "Materials" }).click();
  await expect(page.getByRole("tab", { name: "Materials 0" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Open actions 0" })).toBeVisible();
});
