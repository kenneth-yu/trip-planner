import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

test("the inbox mounts its result lines before anything is decided, and axe is clean", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}/inbox`);
  await expect(kenny.getByText("Nothing waiting.")).toBeVisible();
  const status = kenny.locator("p[role=status]");
  await expect(status).toHaveCount(1);
  await expect(status).toBeEmpty();
  await expect(kenny.locator("p[role=alert]")).toHaveCount(1);
  await expect(kenny.locator("p[role=alert]")).toBeEmpty();
  const results = await new AxeBuilder({ page: kenny }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
