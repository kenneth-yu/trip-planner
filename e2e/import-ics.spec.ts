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

test("an editor uploads a calendar file and finds its events waiting in the review inbox", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${CHICAGO_TRIP}/import`);
  await expect(kenny.getByRole("heading", { name: "Import a calendar" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page: kenny }).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  await kenny.getByLabel(/Calendar file/).setInputFiles({ name: "chicago.ics", mimeType: "text/calendar", buffer: Buffer.from(CALENDAR) });
  await kenny.getByRole("button", { name: "Import file" }).click();
  await expect(kenny.getByRole("status").filter({ hasText: "Sent 1 item to the review inbox." })).toBeVisible();
  await expect(kenny.getByRole("status")).toContainText("1 event was left out");
  expect(kenny.url()).not.toContain("chicago");

  await kenny.getByRole("link", { name: "review inbox", exact: true }).click();
  await expect(kenny.getByText("Dinner at Girl and the Goat").first()).toBeVisible();
  await expect(kenny.getByText("From Calendar file").first()).toBeVisible();
});

test("a file that is not a calendar, and an empty form, say so in plain words", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${CHICAGO_TRIP}/import`);
  await kenny.getByRole("button", { name: "Import file" }).click();
  await expect(kenny.getByRole("alert")).toHaveText("Choose a calendar file first.");
  await kenny.getByLabel(/Calendar file/).setInputFiles({ name: "notes.ics", mimeType: "text/calendar", buffer: Buffer.from("just some words") });
  await kenny.getByRole("button", { name: "Import file" }).click();
  await expect(kenny.getByRole("alert")).toHaveText("We could not read that file as a calendar.");
  const { violations } = await new AxeBuilder({ page: kenny }).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("the link form is not shown until its rate limit rule exists, so no control always refuses", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${CHICAGO_TRIP}/import`);
  await expect(kenny.getByLabel(/Calendar file/)).toBeVisible();
  await expect(kenny.getByLabel(/Calendar link/)).toHaveCount(0);
  await expect(kenny.getByRole("button", { name: "Import link" })).toHaveCount(0);
});

test("the import page is one tap from the add form and from an empty inbox", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${CHICAGO_TRIP}/add`);
  await kenny.getByRole("link", { name: "Import a calendar" }).click();
  await expect(kenny).toHaveURL(new RegExp(`/trips/${CHICAGO_TRIP}/import$`));
  await expect(kenny.getByRole("heading", { name: "Import a calendar" })).toBeVisible();
  await kenny.goto(`/trips/00000000-0000-4000-8300-000000000101/inbox`);
  await kenny.getByRole("link", { name: "Import a calendar" }).click();
  await expect(kenny.getByRole("heading", { name: "Import a calendar" })).toBeVisible();
});
