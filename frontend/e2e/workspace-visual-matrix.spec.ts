import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

const viewports = [
  { name: "desktop", width: 1536, height: 1024 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844 },
] as const;

const managerSections = [
  { button: "Overview", heading: "Before-shift and live overview", slug: "overview" },
  { button: "Team Leaders", heading: "Team Leaders & line control", slug: "team-leaders" },
  { button: "Daily plans", heading: "Daily plans", slug: "daily-plans" },
  { button: "Materials", heading: "Materials & actions", slug: "materials" },
  { button: "Break recovery", heading: "Break recovery & loss history", slug: "break-recovery" },
  { button: "Risk briefing", heading: "AI Daily Risk Briefing", slug: "risk-briefing" },
  { button: "Pilot admin", heading: "Pilot readiness", slug: "pilot-admin" },
] as const;

const teamLeaderSections = [
  { button: "My Lines", mobileButton: "Lines", heading: "My Lines", slug: "my-lines" },
  { button: "Daily Plan", mobileButton: "Plan", heading: "Daily Plan", slug: "daily-plan" },
  { button: "Materials", mobileButton: "Materials", heading: "Materials", slug: "materials" },
  { button: "Break & Recovery", mobileButton: "Recovery", heading: "Break & Recovery", slug: "break-recovery" },
  { button: "Shift Handover", mobileButton: "Handover", heading: "Shift Handover", slug: "shift-handover" },
] as const;

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Operational date").fill(operationalDate);
}

async function assertNoHorizontalOverflow(page: Page) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
}

for (const viewport of viewports) {
  test(`Operations Manager visual matrix is complete on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signIn(page, "demo.manager");
    await expect(
      page.getByRole("heading", { name: "Before-shift and live overview" }),
    ).toBeVisible();

    for (const section of managerSections) {
      if (section.slug !== "overview") {
        if (viewport.width <= 820) {
          await page.getByRole("button", { name: "Open navigation" }).click();
        }
        await page
          .locator("#manager-navigation")
          .getByRole("button", { name: section.button })
          .click();
      }

      await expect(page.getByRole("heading", { name: section.heading })).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(
          `final-uat-manager-${viewport.name}-${section.slug}.png`,
        ),
        animations: "disabled",
        fullPage: true,
      });
    }
  });

  test(`Team Leader visual matrix is complete on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signIn(page, "demo.leader");
    await expect(page.getByRole("heading", { name: "My Lines" })).toBeVisible();

    const navigation = viewport.width <= 900
      ? page.getByRole("navigation", { name: "Team Leader mobile workspace" })
      : page.getByRole("navigation", { name: "Team Leader sections" });

    for (const section of teamLeaderSections) {
      await navigation
        .getByRole("button", {
          name: viewport.width <= 900 ? section.mobileButton : section.button,
          exact: true,
        })
        .click();
      await expect(page.getByRole("heading", { name: section.heading })).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(
          `final-uat-team-leader-${viewport.name}-${section.slug}.png`,
        ),
        animations: "disabled",
        fullPage: true,
      });
    }
  });
}
