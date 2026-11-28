import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

const PAGE = `/trips/${DECEMBER_TRIP}/import/google`;

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test("the Google import page offers to connect, and axe is clean", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", PAGE);
  await expect(kenny.getByRole("heading", { name: "Import from Google Calendar" })).toBeVisible();
  await expect(kenny.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
  expect(await seriousViolations(kenny)).toEqual([]);
});

test("a declined Google sign in shows an alert and still offers to connect, and axe is clean", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `${PAGE}?consent=declined`);
  await expect(kenny.getByRole("alert").filter({ hasText: "Google calendar access was not granted." })).toBeVisible();
  await expect(kenny.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
  expect(await seriousViolations(kenny)).toEqual([]);
});

test("connecting the fake Google lists the person's calendars with the dates filled in, and axe is clean", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", PAGE);
  await kenny.getByRole("link", { name: "Connect Google Calendar" }).click();
  await expect(kenny).toHaveURL(new RegExp(`${PAGE}$`));
  await expect(kenny.locator("fieldset label")).toHaveText(["kenny primary", "kenny primary (from Gmail)", "shared China"]);
  await expect(kenny.getByLabel("From", { exact: true })).toHaveValue("2026-11-30");
  await expect(kenny.getByLabel("To", { exact: true })).toHaveValue("2026-12-17");
  await expect(kenny.getByRole("button", { name: "Import" })).toBeEnabled();
  expect(await seriousViolations(kenny)).toEqual([]);
});
