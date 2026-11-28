import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { addPlan, DECEMBER_TRIP, STANFORD_HOTEL } from "./trips";

test.setTimeout(120_000);

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

test("a dinner set for the morning gets a line with Why? and a one tap fix", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}`);
  await addPlan(kenny, DECEMBER_TRIP, { title: "Dinner at Gonpachi", date: "2026-12-04", starts: "06:30", ends: "08:00" });
  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-04`);
  const line = kenny.getByText("Dinner at 6:30am? Did you mean 6:30pm?").filter({ visible: true }).first();
  await expect(line).toBeVisible();

  const why = kenny.getByRole("button", { name: "Why? Dinner at 6:30am? Did you mean 6:30pm?" }).filter({ visible: true }).first();
  expect((await why.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(why).toHaveAttribute("aria-expanded", "false");
  await why.click();
  await expect(why).toHaveAttribute("aria-expanded", "true");
  await expect(kenny.getByText(/Dinner at Gonpachi is set for 6:30am/).filter({ visible: true }).first()).toBeVisible();
  await expectNoSeriousViolations(kenny);

  await kenny.getByRole("button", { name: "Change to 6:30pm" }).filter({ visible: true }).first().click();
  await expect(kenny.getByText("Dinner at 6:30am? Did you mean 6:30pm?")).toHaveCount(0);
  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-04`);
  await expect(kenny.getByText("6:30pm").filter({ visible: true }).first()).toBeVisible();
});

test("the same line is in Worth a look and This is fine hides it", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}`);
  await addPlan(kenny, DECEMBER_TRIP, { title: "Dinner at Ramen Street", date: "2026-12-04", starts: "05:45", ends: "07:00" });
  await kenny.goto(`/trips/${DECEMBER_TRIP}/deadlines`);
  const row = kenny.getByRole("listitem").filter({ hasText: "Dinner at 5:45am? Did you mean 5:45pm?" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^This is fine/ }).click();
  await expect(kenny.getByRole("status").filter({ hasText: "Marked as fine." })).toBeVisible();
});

test("the stay has an About how long to the airport field that shows on its page", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}/items/${STANFORD_HOTEL}/edit`);
  await kenny.getByRole("button", { name: "More details" }).click();
  await expect(kenny.getByText("About how long to the airport?")).toBeVisible();
  await kenny.getByLabel("Hours", { exact: true }).fill("1");
  await kenny.getByLabel("Minutes", { exact: true }).fill("15");
  await kenny.getByRole("button", { name: "Save changes" }).click();
  await expect(kenny).toHaveURL(/\/items\/[0-9a-f-]+$/);
  await expect(kenny.getByText("About 1 hour 15 minutes to the airport.")).toBeVisible();
  await expectNoSeriousViolations(kenny);
});

test("Travel tips on the account page save, and tips off leaves warnings alone", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", "/account#travel-smarts");
  const section = kenny.locator("#travel-smarts");
  await expect(section.getByRole("heading", { name: "Travel tips" })).toBeVisible();
  await expect(section.getByText(/always show/)).toBeVisible();
  await expect(section.getByRole("checkbox")).toHaveCount(6);
  const tips = section.getByLabel("Show travel tips");
  await tips.uncheck();
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await kenny.reload();
  await expect(kenny.locator("#travel-smarts").getByLabel("Show travel tips")).not.toBeChecked();
  await expectNoSeriousViolations(kenny);

  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-04`);
  await expect(kenny.getByText(/Store your bags\?/)).toHaveCount(0);
  await expect(kenny.getByText(/Leave the hotel by|Be at the airport by/)).toHaveCount(0);

  await kenny.goto("/account#travel-smarts");
  await kenny.locator("#travel-smarts").getByLabel("Show travel tips").check();
  await kenny.locator("#travel-smarts").getByRole("button", { name: "Save" }).click();
  await expect(kenny.locator("#travel-smarts").getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
});
