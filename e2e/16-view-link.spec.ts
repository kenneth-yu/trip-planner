import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

async function seriousProblems(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

async function turnOn(page: Page): Promise<string> {
  await page.goto(`/trips/${DECEMBER_TRIP}/share`);
  const link = page.getByRole("switch", { name: /Anyone with the link can see this trip/ });
  if (await link.isChecked()) {
    await link.click();
    await expect(link).not.toBeChecked();
  }
  await link.click();
  await expect(link).toBeChecked();
  const field = page.getByLabel("Link for family and friends");
  await expect(field).toBeVisible();
  return field.inputValue();
}

test("a visitor opens the link, sees where they are and nothing private, and a new link replaces the old one", async ({ page, signIn, browser }) => {
  await signIn("kenny");
  const link = await turnOn(page);
  expect(link).toMatch(/\/v\/tpv_/);
  expect(await seriousProblems(page)).toEqual([]);

  const visitor = await browser.newContext({ timezoneId: "Europe/London" });
  const guest = await visitor.newPage();
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByRole("heading", { name: "Asia, December 2026" })).toBeVisible();
  await expect(guest.getByText(/They leave in \d+ days?\./)).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Up next" })).toBeVisible();
  const html = await guest.content();
  for (const secret of ["PLACEHOLDER_", "30K", "30C", "Busy", "Worth a look", "Decisions"]) expect(html).not.toContain(secret);
  await expect(guest.getByRole("link", { name: "Share" })).toHaveCount(0);
  expect(await seriousProblems(guest)).toEqual([]);

  await page.getByRole("button", { name: "Make a new link" }).click();
  await expect(page.getByText("Make a new link? The current one stops working right away.")).toBeVisible();
  await page.getByRole("button", { name: "Make new link" }).click();
  await expect(page.getByLabel("Link for family and friends")).not.toHaveValue(link);

  const response = await guest.goto(new URL(link).pathname);
  expect(response?.status()).toBe(404);
  await expect(guest.getByText("This link no longer works.")).toBeVisible();
  await expect(guest.getByText("Ask whoever sent it for a new one.")).toBeVisible();
  expect(await seriousProblems(guest)).toEqual([]);
  await visitor.close();
});

test("turning on Show deadlines adds a Decisions section for the visitor", async ({ page, signIn, browser }) => {
  await signIn("kenny");
  const link = await turnOn(page);
  await page.getByRole("switch", { name: /Show deadlines on the link/ }).click();
  await expect(page.getByRole("switch", { name: /Show deadlines on the link/ })).toBeChecked();
  await expect(page.getByText("Saved")).toBeVisible();

  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByRole("heading", { name: "Decisions" })).toBeVisible();
  await visitor.close();
});

test("junk, unknown and malformed links all give the same not working page", async ({ browser }) => {
  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  for (const path of ["/v/nonsense", `/v/tpv_${"A".repeat(43)}`, "/v/tpv_"]) {
    const response = await guest.goto(path);
    expect(response?.status()).toBe(404);
    await expect(guest.getByText("This link no longer works.")).toBeVisible();
  }
  await visitor.close();
});
