import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

const CHICAGO_TRIP = "00000000-0000-4000-8300-000000000102";

const CALENDAR = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//e2e//EN",
  "BEGIN:VEVENT",
  "UID:e2e-1@example.test",
  "DTSTART;TZID=America/Chicago:20270417T190000",
  "DTEND;TZID=America/Chicago:20270417T210000",
  "SUMMARY:Dinner at Girl and the Goat",
  "LOCATION:809 W Randolph St\\, Chicago",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:e2e-2@example.test",
  "DTSTART:20270417T150000Z",
  "DTEND:20270417T160000Z",
  "SUMMARY:Cancelled walk",
  "STATUS:CANCELLED",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("an editor uploads a calendar file inside the trip's dates and lands in the review inbox", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${CHICAGO_TRIP}/import`);
  await expect(kenny.getByRole("heading", { name: "Import bookings" })).toBeVisible();
  await expect(kenny.getByLabel("From")).toHaveValue("2027-04-15");
  await expect(kenny.getByLabel("To")).toHaveValue("2027-04-19");
  await expect(kenny.getByText("Events outside these dates are left out.")).toBeVisible();
  const { violations } = await new AxeBuilder({ page: kenny }).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  await kenny.getByLabel("Calendar file").setInputFiles({ name: "chicago.ics", mimeType: "text/calendar", buffer: Buffer.from(CALENDAR) });
  await kenny.getByRole("button", { name: "Import" }).click();
  await expect(kenny).toHaveURL(new RegExp(`/trips/${CHICAGO_TRIP}/inbox\\?imported=1&matched=0&left=1$`));
  expect(kenny.url()).not.toContain("chicago.ics");
  await expect(kenny.locator("p[role=status]").filter({ hasText: "1 event is waiting in your inbox." })).toHaveText("1 event is waiting in your inbox. 1 was left out: cancelled, outside your dates, or with no readable time.");
  await expect(kenny.getByText("Dinner at Girl and the Goat").first()).toBeVisible();
  await expect(kenny.getByText("From Calendar file").first()).toBeVisible();
});

test("dates that leave nothing, dates the wrong way round, and a file that is no calendar, say so in plain words", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${CHICAGO_TRIP}/import`);
  await kenny.getByRole("button", { name: "Import" }).click();
  await expect(kenny.locator("p[role=alert]")).toHaveText("Choose a file or paste a link.");
  await expect(kenny.locator("p[role=alert]")).toBeFocused();

  await kenny.getByLabel("Calendar file").setInputFiles({ name: "chicago.ics", mimeType: "text/calendar", buffer: Buffer.from(CALENDAR) });
  await kenny.getByLabel("From").fill("2031-01-01");
  await kenny.getByLabel("To").fill("2031-01-31");
  await kenny.getByRole("button", { name: "Import" }).click();
  await expect(kenny.locator("p[role=alert]")).toHaveText("Nothing in that calendar falls between Jan 1 and Jan 31. Change the dates or leave them empty.");

  await kenny.getByLabel("Calendar file").setInputFiles({ name: "chicago.ics", mimeType: "text/calendar", buffer: Buffer.from(CALENDAR) });
  await kenny.getByLabel("From").fill("2027-04-19");
  await kenny.getByLabel("To").fill("2027-04-15");
  await kenny.getByRole("button", { name: "Import" }).click();
  await expect(kenny.locator("p[role=alert]")).toHaveText("The From date is after the To date.");

  await kenny.getByLabel("Calendar file").setInputFiles({ name: "notes.ics", mimeType: "text/calendar", buffer: Buffer.from("just some words") });
  await kenny.getByRole("button", { name: "Import" }).click();
  await expect(kenny.locator("p[role=alert]")).toHaveText("That does not look like a calendar file. Choose a file that ends in .ics.");
  const { violations } = await new AxeBuilder({ page: kenny }).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("the link form is not shown until its rate limit rule exists, so no control always refuses", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${CHICAGO_TRIP}/import`);
  await expect(kenny.getByLabel("Calendar file")).toBeVisible();
  await expect(kenny.getByLabel("Calendar link")).toHaveCount(0);
  await expect(kenny.getByRole("button", { name: "Import" })).toHaveCount(1);
});

test("the import page is one tap from the add form and from an empty inbox", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${CHICAGO_TRIP}/add`);
  await kenny.getByRole("link", { name: "Bring in bookings from a calendar" }).click();
  await expect(kenny).toHaveURL(new RegExp(`/trips/${CHICAGO_TRIP}/import$`));
  await expect(kenny.getByRole("heading", { name: "Import bookings" })).toBeVisible();
  await kenny.goto(`/trips/00000000-0000-4000-8300-000000000101/inbox`);
  await kenny.getByRole("link", { name: "Import bookings", exact: true }).click();
  await expect(kenny.getByRole("heading", { name: "Import bookings" })).toBeVisible();
});
