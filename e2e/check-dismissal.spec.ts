import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP, LISBON_TRIP } from "./trips";

const DEADLINES = `/trips/${DECEMBER_TRIP}/deadlines`;

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

test("This is fine hides a check for the whole trip, can be undone, and is listed for the other editor", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", DEADLINES);
  await expect(kenny.getByRole("heading", { name: "Deadlines and checks" })).toBeVisible();
  await expect(kenny.getByRole("heading", { name: "Worth a look" })).toBeVisible();

  const overlap = kenny.getByRole("listitem").filter({ hasText: "Two stays overlap" }).first();
  const sentence = (await overlap.locator("div").first().innerText()).trim();
  const fine = overlap.getByRole("button", { name: /^This is fine: Two stays overlap/ });
  await expect(fine).toBeVisible();
  expect((await fine.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await fine.click();
  await expect(kenny.getByRole("status").filter({ hasText: "Marked as fine." })).toBeVisible();
  const undo = kenny.getByRole("button", { name: "Undo" }).first();
  await expect(undo).toBeFocused();

  await kenny.goto(DEADLINES);
  await expect(kenny.getByText(sentence, { exact: true }).filter({ visible: true })).toHaveCount(0);
  const folded = kenny.getByText(/^Marked as fine \(\d+\)$/);
  await expect(folded).toBeVisible();
  await folded.click();
  await expect(kenny.getByText(/^You, [A-Z][a-z]{2} \d{1,2}$/).first()).toBeVisible();
  await expectNoSeriousViolations(kenny);

  const jacob = await pageSignedInAs("jacob", DEADLINES);
  await expect(jacob.getByText(sentence, { exact: true }).filter({ visible: true })).toHaveCount(0);
  await jacob.getByText(/^Marked as fine \(\d+\)$/).click();
  await expect(jacob.getByText(/^Kenneth, [A-Z][a-z]{2} \d{1,2}$/).first()).toBeVisible();
  await jacob.getByRole("button", { name: "Show again" }).first().click();
  await expect(jacob.getByRole("status").filter({ hasText: "Showing again." })).toBeVisible();
  await jacob.goto(DEADLINES);
  await expect(jacob.getByText(sentence, { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

test("a check on the trip page links to its line on the deadlines page", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}`);
  const links = kenny.locator(`a[href*="/deadlines#check-"]`);
  const href = await links.first().getAttribute("href");
  expect(href).toMatch(/\/deadlines#check-[0-9a-f]{16}$/);
  await kenny.goto(href ?? DEADLINES);
  const target = kenny.locator(":target");
  await expect(target).toBeVisible();
  expect(await target.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
});

test("an empty trip has no Worth a look and no folded list", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${LISBON_TRIP}/deadlines`);
  await expect(kenny.getByRole("heading", { name: "Deadlines and checks" })).toBeVisible();
  await expect(kenny.getByRole("heading", { name: "Worth a look" })).toHaveCount(0);
  await expect(kenny.getByText(/^Marked as fine/)).toHaveCount(0);
});
