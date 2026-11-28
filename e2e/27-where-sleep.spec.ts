import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

async function addFlight(page: Page, tripUrl: string, flight: { number: string; date: string; from: string; to: string; departs: string; arrives: string }): Promise<void> {
  await page.goto(`${tripUrl}/add`);
  await page.locator("[name=flightNumber]").fill(flight.number);
  await page.locator("[name=date]").fill(flight.date);
  await page.locator("[name=from]").fill(flight.from);
  await page.locator("[name=to]").fill(flight.to);
  await page.locator("[name=departs]").fill(flight.departs);
  await page.locator("[name=arrives]").fill(flight.arrives);
  await page.getByRole("button", { name: "Add flight" }).click();
  await expect(page).toHaveURL(/added=/);
}

test("a new trip starts with the flights, then says which nights need a bed", async ({ page, signIn }) => {
  await signIn("kenny", "/trips/new");
  await page.getByLabel("Trip name").fill("Hong Kong in January");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/);
  const tripUrl = new URL(page.url()).pathname;

  await expect(page.getByText("Start with your flights.").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Booked or not, add the flights first. The app works out which nights you need a bed, in local time.").filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a flight" }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Connect Claude or ChatGPT")).toHaveCount(0);
  await expectNoSeriousViolations(page);

  await addFlight(page, tripUrl, { number: "CX845", date: "2027-01-15", from: "JFK", to: "HKG", departs: "09:00", arrives: "14:00" });
  await addFlight(page, tripUrl, { number: "CX846", date: "2027-01-27", from: "HKG", to: "JFK", departs: "16:00", arrives: "18:30" });
  await page.goto(tripUrl);

  await expect(page.getByRole("heading", { name: "You need a place to stay: 11 nights" }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Check in Sat Jan 16 · Check out Wed Jan 27").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Not Fri Jan 15: you're on the plane.").filter({ visible: true })).toBeVisible();

  const why = page.getByRole("button", { name: "Why?" }).filter({ visible: true });
  await expect(why).toHaveAttribute("aria-expanded", "false");
  await why.click();
  await expect(why).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/You leave New York Fri Jan 15 at 9:00am and land in Hong Kong Sat Jan 16 at 2:00pm Hong Kong time/).filter({ visible: true })).toBeVisible();

  await page.getByText("Night by night").filter({ visible: true }).first().click();
  await expect(page.getByText("Hong Kong, 11 nights").filter({ visible: true })).toBeVisible();
  await expectNoSeriousViolations(page);

  const action = page.getByRole("link", { name: "Add a stay for these nights" }).filter({ visible: true });
  const href = new URL((await action.getAttribute("href")) ?? "", page.url());
  expect(Object.fromEntries(href.searchParams)).toEqual({ type: "stay", city: "Hong Kong", checkIn: "2027-01-16", checkOut: "2027-01-27", booked: "no" });

  await action.click();
  await expect(page).toHaveURL(/\/add\?/);
  await expect(page.getByLabel("Stay", { exact: true })).toBeChecked();
  await expect(page.locator("[name=place]")).toHaveValue("Hong Kong");
  await expect(page.locator("[name=checkInDate]")).toHaveValue("2027-01-16");
  await expect(page.locator("[name=checkOutDate]")).toHaveValue("2027-01-27");
});
