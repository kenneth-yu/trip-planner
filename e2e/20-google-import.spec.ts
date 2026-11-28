import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

const PAGE = `/trips/${DECEMBER_TRIP}/import/google`;

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test("the Google import page says what Google will ask and offers to continue, and axe is clean", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", PAGE);
  await expect(kenny.getByRole("heading", { name: "Import from Google Calendar" })).toBeVisible();
  await expect(kenny.getByText("Everything comes into your review inbox first. Nothing is added until you say so.")).toBeVisible();
  const link = kenny.getByRole("link", { name: "Continue to Google" });
  await expect(link).toBeVisible();
  expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await seriousViolations(kenny)).toEqual([]);
});

test("a declined Google sign in shows an alert and still offers to continue, and axe is clean", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `${PAGE}?consent=declined`);
  await expect(kenny.getByRole("alert").filter({ hasText: "Google Calendar was not connected, so nothing was imported." })).toBeVisible();
  await expect(kenny.getByRole("link", { name: "Continue to Google" })).toBeVisible();
  expect(await seriousViolations(kenny)).toEqual([]);
});

test("continuing through the fake Google lists the person's calendars in 44px rows with the dates filled in, and axe is clean", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", PAGE);
  await kenny.getByRole("link", { name: "Continue to Google" }).click();
  await expect(kenny).toHaveURL(new RegExp(`${PAGE}$`));
  await expect(kenny.getByRole("heading", { name: "Choose what to bring in" })).toBeVisible();
  await expect(kenny.getByText(/^From .+@/)).toBeVisible();
  const rows = kenny.locator("fieldset label").filter({ has: kenny.getByRole("checkbox") });
  await expect(rows).toHaveText(["kenny primary", "kenny primary (from Gmail)", "shared China"]);
  for (const row of await rows.all()) expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(kenny.getByLabel("From", { exact: true })).toHaveValue("2026-11-30");
  await expect(kenny.getByLabel("To", { exact: true })).toHaveValue("2026-12-17");
  await expect(kenny.getByText("Only events between these dates come in.")).toBeVisible();
  await expect(kenny.getByRole("button", { name: "Import" })).toBeEnabled();
  expect(await seriousViolations(kenny)).toEqual([]);
});

test("the review inbox links to the import page for an editor", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}/inbox`);
  const link = kenny.getByRole("link", { name: "Import from Google Calendar" });
  await expect(link).toHaveAttribute("href", PAGE);
});
