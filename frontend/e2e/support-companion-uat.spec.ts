import { expect, test, type Page } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? "";
const operationalDate = process.env.E2E_OPERATIONAL_DATE ?? "2026-09-04";

const viewports = [
  { name: "desktop", width: 1536, height: 1024 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844 },
] as const;

const sections = [
  { button: "Support Overview", mobileButton: "Overview", heading: "My response queue", slug: "overview" },
  { button: "My Actions", mobileButton: "Actions", heading: "My actions", slug: "actions" },
  { button: "Line Status", mobileButton: "Lines", heading: "Line status", slug: "lines" },
  { button: "Material Risks", mobileButton: "Materials", heading: "Material risks", slug: "materials" },
  { button: "Response Guide", mobileButton: "Guide", heading: "Response guide", slug: "guide" },
] as const;

test.beforeEach(() => {
  test.skip(!password, "Set E2E_PASSWORD to run browser acceptance tests.");
});

async function signInAsSupport(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(
    process.env.DEMO_SUPPORT_USERNAME ?? "demo.support",
  );
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Operational date").fill(operationalDate);
  await expect(page.getByRole("heading", { name: "My response queue" })).toBeVisible();
}

function navigation(page: Page, viewportWidth: number) {
  return viewportWidth <= 900
    ? page.getByRole("navigation", { name: "Operational Support mobile workspace" })
    : page.getByRole("navigation", { name: "Operational Support sections" });
}

for (const viewport of viewports) {
  test(`Operational Support covers every section on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signInAsSupport(page);

    await expect(page.getByText("1 assigned · 1 available")).toHaveCount(1);
    await expect(page.getByText("Filler pressure repeatedly dropping")).toBeVisible();
    await expect(page.getByText("Label feed alignment issue")).toBeVisible();
    await expect(page.getByRole("button", { name: "Acknowledge action" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim & acknowledge" })).toBeVisible();

    const workspaceNavigation = navigation(page, viewport.width);
    await expect(workspaceNavigation.getByRole("button")).toHaveCount(5);

    for (const section of sections) {
      await workspaceNavigation
        .getByRole("button", {
          name: viewport.width <= 900 ? section.mobileButton : section.button,
          exact: true,
        })
        .click();
      await expect(page.getByRole("heading", { name: section.heading })).toBeVisible();

      if (section.slug === "lines") {
        await expect(page.getByText("DEMO-LINE-01")).toBeVisible();
        await expect(page.getByText("DEMO-LINE-02")).toBeVisible();
      }
      if (section.slug === "materials") {
        await expect(page.getByText("Oat Milk Chai")).toBeVisible();
        await expect(page.getByText("BBQ Chicken Bites")).toBeVisible();
      }

      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(horizontalOverflow).toBe(false);

      await page.screenshot({
        path: testInfo.outputPath(
          `support-companion-${viewport.name}-${section.slug}.png`,
        ),
        animations: "disabled",
        fullPage: true,
      });
    }
  });
}
