import { expect, type Page } from "@playwright/test";

export const DECEMBER_TRIP = "00000000-0000-4000-8300-000000000001";
export const LISBON_TRIP = "00000000-0000-4000-8300-000000000101";

export async function addPlan(page: Page, tripId: string, plan: { title: string; date: string; starts: string; ends: string; onlyMe?: boolean; showAsBusy?: boolean }): Promise<void> {
  await page.goto(`/trips/${tripId}/add`);
  await page.getByLabel("Plan").check();
  await page.locator("[name=title]").fill(plan.title);
  await page.locator("[name=place]").fill("Tokyo");
  await page.locator("[name=date]").fill(plan.date);
  await page.locator("[name=starts]").fill(plan.starts);
  await page.locator("[name=ends]").fill(plan.ends);
  if (plan.onlyMe) {
    await page.getByRole("button", { name: "More details" }).click();
    await page.getByLabel("Only me").check();
    if (plan.showAsBusy) await page.getByLabel(/Show as busy/).check();
  }
  await page.getByRole("button", { name: "Add plan" }).click();
  await expect(page).toHaveURL(/added=/);
}
