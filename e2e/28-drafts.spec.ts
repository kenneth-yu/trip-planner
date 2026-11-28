import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

test("a flight can be added as not booked yet, then marked as booked", async ({ page, signIn }) => {
  await signIn("kenny", "/trips/new");
  await page.getByLabel("Trip name").fill("Drafts demo");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/);
  const tripUrl = new URL(page.url()).pathname;

  await page.goto(`${tripUrl}/add`);
  await expect(page.getByRole("group", { name: "Is it booked?" })).toBeVisible();
  await expect(page.getByLabel("Not yet")).toBeChecked();
  await page.locator("[name=from]").fill("JFK");
  await page.locator("[name=to]").fill("HKG");
  await page.locator("[name=date]").fill("2027-01-15");
  await page.locator("[name=departs]").fill("09:00");
  await expect(page.getByText("About how long?")).toBeVisible();
  await page.locator("[name=hours]").fill("16");
  await page.locator("[name=minutes]").fill("0");
  await expectNoSeriousViolations(page);
  await page.getByRole("button", { name: "Add flight" }).click();
  await expect(page).toHaveURL(/added=/);

  const id = new URL(page.url()).searchParams.get("added");
  expect(id).not.toBeNull();
  await page.goto(`${tripUrl}/items/${id}`);
  await expect(page.getByText("Not booked yet.")).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole("link", { name: "Mark as booked" }).click();
  await expect(page).toHaveURL(/booked=yes/);
  await expect(page.getByLabel("Yes", { exact: true })).toBeChecked();
  await page.locator("[name=flightNumber]").fill("CX845");
  await page.locator("[name=arrives]").fill("14:00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/items/${id}$`));
  await expect(page.getByText("Not booked yet.")).toHaveCount(0);
});
