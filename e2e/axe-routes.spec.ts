import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const routes = (process.env.AXE_ROUTES ?? "").split(",").filter((route) => route.length > 0);

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).options({ rules: { "label-content-name-mismatch": { enabled: true } } }).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

test.describe("axe on the page routes this pull request touches", () => {
  test.skip(routes.length === 0, "No page route was touched.");

  for (const route of routes) {
    test(`${route} has no serious or critical violations, label content name mismatch included`, async ({ page, pageSignedInAs }) => {
      if (route === "/sign-in") {
        await page.goto(route);
        await page.waitForLoadState("load");
        expect(await seriousViolations(page)).toEqual([]);
        return;
      }
      const signedIn = await pageSignedInAs("kenny", route);
      await signedIn.waitForLoadState("load");
      expect(await seriousViolations(signedIn)).toEqual([]);
    });
  }
});
