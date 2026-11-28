import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { addPlan, DECEMBER_TRIP, STANFORD_HOTEL } from "./trips";

test.setTimeout(180_000);

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

const visible = (page: Page, text: string | RegExp) => page.getByText(text).filter({ visible: true }).first();

async function addFlight(page: Page, flight: { number: string; date: string; from: string; to: string; departs: string; arrives: string }): Promise<void> {
  await page.goto(`/trips/${DECEMBER_TRIP}/add`);
  await page.getByLabel("Flight", { exact: true }).check();
  await page.locator("[name=flightNumber]").fill(flight.number);
  await page.locator("[name=date]").fill(flight.date);
  await page.locator("[name=from]").fill(flight.from);
  await page.locator("[name=to]").fill(flight.to);
  await page.locator("[name=departs]").fill(flight.departs);
  await page.locator("[name=arrives]").fill(flight.arrives);
  await page.getByRole("button", { name: "Add flight" }).click();
  await expect(page).toHaveURL(/added=/);
}

test("a dinner set for the morning gets a line with Why? and a one tap fix, and the change is announced after the refresh", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}`);
  await addPlan(kenny, DECEMBER_TRIP, { title: "Dinner at Gonpachi", date: "2026-12-04", starts: "06:30", ends: "08:00" });
  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-04`);
  await expect(visible(kenny, "Dinner at 6:30am? Did you mean 6:30pm?")).toBeVisible();

  const why = kenny.getByRole("button", { name: "Why? Dinner at 6:30am? Did you mean 6:30pm?" }).filter({ visible: true }).first();
  expect((await why.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(why).toHaveAttribute("aria-expanded", "false");
  await why.click();
  await expect(why).toHaveAttribute("aria-expanded", "true");
  await expect(visible(kenny, /Dinner at Gonpachi is set for 6:30am/)).toBeVisible();
  await expectNoSeriousViolations(kenny);

  await kenny.getByRole("button", { name: "Change to 6:30pm" }).filter({ visible: true }).first().click();
  await expect(kenny.getByRole("status").filter({ hasText: "Time changed." })).toBeVisible();
  await expect(kenny.getByText("Dinner at 6:30am? Did you mean 6:30pm?")).toHaveCount(0);
  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-04`);
  await expect(visible(kenny, "6:30pm")).toBeVisible();
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

test("a short connection reads under the second flight with Why?", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}`);
  await addFlight(kenny, { number: "BR 892", date: "2026-12-05", from: "HKG", to: "TPE", departs: "14:15", arrives: "16:05" });
  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-05`);
  const line = "Tight: 50 min to change planes at HKG.";
  await expect(visible(kenny, line)).toBeVisible();
  const why = kenny.getByRole("button", { name: `Why? ${line}` }).filter({ visible: true }).first();
  await why.click();
  await expect(why).toHaveAttribute("aria-expanded", "true");
  await expectNoSeriousViolations(kenny);
});

test("tips show under flights and check ins, and Hide tips like this hides that kind with a message", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}?day=2026-12-05`);
  await expect(visible(kenny, "Be at the airport by 5:50am.")).toBeVisible();
  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-02`);
  const tip = "About 8 hours before check-in. Store your bags?";
  await expect(visible(kenny, tip)).toBeVisible();
  await kenny.getByRole("button", { name: `Why? ${tip}` }).filter({ visible: true }).first().click();
  await kenny.getByRole("button", { name: "Hide tips like this" }).filter({ visible: true }).first().click();
  await expect(kenny.getByRole("status").filter({ hasText: "Tips like this are hidden." })).toBeVisible();
  await expect(kenny.getByText(tip)).toHaveCount(0);
  await kenny.goto("/account#travel-smarts");
  await expect(kenny.locator("#travel-smarts").getByLabel("Storing bags between check-in and check-out")).not.toBeChecked();
  await kenny.locator("#travel-smarts").getByLabel("Storing bags between check-in and check-out").check();
  await kenny.locator("#travel-smarts").getByRole("button", { name: "Save" }).click();
  await expect(kenny.locator("#travel-smarts").getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
});

test("a view link visitor sees no tips and no travel smart buttons", async ({ page, signIn, browser }) => {
  await signIn("kenny");
  await page.goto(`/trips/${DECEMBER_TRIP}/share`);
  const toggle = page.getByRole("switch", { name: /Anyone with the link can see this trip/ });
  if (await toggle.isChecked()) {
    await toggle.click();
    await expect(toggle).not.toBeChecked();
  }
  await toggle.click();
  await expect(toggle).toBeChecked();
  const link = await page.getByLabel("Link for family and friends").inputValue();
  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByRole("heading", { name: "Asia, December 2026" })).toBeVisible();
  for (const text of ["Be at the airport by", "Store your bags?", "Hide tips like this", "Change to ", "This is fine", "Travel tips are small suggestions"]) {
    await expect(guest.getByText(text)).toHaveCount(0);
  }
  await visitor.close();
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

test("Travel tips on the account page: axe with tips on and off, and tips off hides a tip but not a warning", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}`);
  await addPlan(kenny, DECEMBER_TRIP, { title: "Dinner at Omoide", date: "2026-12-03", starts: "05:15", ends: "06:30" });
  const day = `/trips/${DECEMBER_TRIP}?day=2026-12-03`;
  const tipDay = `/trips/${DECEMBER_TRIP}?day=2026-12-05`;
  const warning = "Dinner at 5:15am? Did you mean 5:15pm?";

  await kenny.goto(tipDay);
  await expect(visible(kenny, "Be at the airport by 5:50am.")).toBeVisible();
  await kenny.goto(day);
  await expect(visible(kenny, warning)).toBeVisible();

  await kenny.goto("/account#travel-smarts");
  const section = kenny.locator("#travel-smarts");
  await expect(section.getByRole("heading", { name: "Travel tips" })).toBeVisible();
  await expect(section.getByText(/always show/)).toBeVisible();
  await expect(section.getByRole("checkbox")).toHaveCount(6);
  await expectNoSeriousViolations(kenny);
  await section.getByLabel("Show travel tips").uncheck();
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await kenny.reload();
  await expect(kenny.locator("#travel-smarts").getByLabel("Show travel tips")).not.toBeChecked();
  await expectNoSeriousViolations(kenny);

  await kenny.goto(tipDay);
  await expect(kenny.getByText("Be at the airport by 5:50am.")).toHaveCount(0);
  await kenny.goto(day);
  await expect(visible(kenny, warning)).toBeVisible();

  await kenny.goto("/account#travel-smarts");
  await kenny.locator("#travel-smarts").getByLabel("Show travel tips").check();
  await kenny.locator("#travel-smarts").getByRole("button", { name: "Save" }).click();
  await expect(kenny.locator("#travel-smarts").getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await kenny.goto(tipDay);
  await expect(visible(kenny, "Be at the airport by 5:50am.")).toBeVisible();
});
