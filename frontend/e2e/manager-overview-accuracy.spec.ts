import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

const viewports = [
  { name: "desktop", width: 1536, height: 1024 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844 },
] as const;

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

for (const viewport of viewports) {
  test(`manager overview reports real shift issues on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signInAsManager(page);

    const attention = page.getByRole("region", { name: "Attention summary" });
    await expect(attention.getByText("1 critical issue")).toBeVisible();
    await expect(attention.getByText("2 material risks")).toBeVisible();
    await expect(attention.getByText("4 open actions")).toBeVisible();
    await expect(attention.getByText("0 missing updates")).toBeVisible();

    const priorities = page.getByRole("region", { name: "Suggested priorities" });
    await expect(
      priorities.getByText("Line 1: Filler pressure repeatedly dropping"),
    ).toBeVisible();
    await expect(
      priorities.getByText("Line isolated and engineering contacted."),
    ).toBeVisible();
    await expect(priorities.getByText(/conveyor reset/i)).toHaveCount(0);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBe(false);

    await page.screenshot({
      path: testInfo.outputPath(`manager-overview-accuracy-${viewport.name}.png`),
      animations: "disabled",
      fullPage: true,
    });
  });
}
