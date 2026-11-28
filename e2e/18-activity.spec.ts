import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function seriousProblems(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

test("a new trip says nothing has changed, then an added flight shows with Undo and the undo is announced", async ({ page, signIn }) => {
  await signIn("kenny", "/trips/new");
  await page.getByLabel("Trip name").fill("Activity check trip");
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.waitForURL(/\/trips\/[0-9a-f-]{36}/);
  const trip = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/trips/${trip}/activity`);
  await expect(page.getByText("Nothing has changed yet. Changes to this trip will show here.")).toBeVisible();
  expect(await seriousProblems(page)).toEqual([]);

  await page.goto(`/trips/${trip}/add`);
  await page.locator("[name=flightNumber]").fill("NH159");
  await page.locator("[name=date]").fill("2026-12-01");
  await page.locator("[name=from]").fill("JFK");
  await page.locator("[name=to]").fill("HND");
  await page.locator("[name=departs]").fill("00:55");
  await page.locator("[name=arrives]").fill("05:25");
  await page.getByRole("button", { name: "Add flight" }).click();
  await expect(page).toHaveURL(/added=/);

  await page.goto(`/trips/${trip}/activity`);
  await expect(page.getByText(/^You added /)).toBeVisible();
  expect(await seriousProblems(page)).toEqual([]);

  await page.getByRole("button", { name: /^Undo: You added/ }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("Removed");
  await expect(status).toBeFocused();
  expect(await seriousProblems(page)).toEqual([]);
});

test("the December log shows the owner no codes or seats", async ({ page, signIn }) => {
  await signIn("kenny", `/trips/00000000-0000-4000-8300-000000000001/activity`);
  const html = await page.content();
  for (const secret of ["PLACEHOLDER_", "30K", "30C"]) expect(html).not.toContain(secret);
  expect(await seriousProblems(page)).toEqual([]);
});
