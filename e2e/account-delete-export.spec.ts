import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

test("delete a trip you made: wrong name is refused, any case matches, the line shows once", async ({ page, signIn }) => {
  await signIn("kenny", "/trips/new");
  await page.getByLabel("Trip name", { exact: true }).fill("Scratch weekend");
  await page.getByRole("button", { name: "Create trip", exact: true }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/);
  const tripUrl = new URL(page.url());

  await page.goto(`${tripUrl.pathname}/settings/delete`);
  await expect(page.getByRole("heading", { name: "Delete Scratch weekend", exact: true })).toBeVisible();
  await expect(page.getByText("lose access")).toHaveCount(0);
  await expect(page.getByText("If anyone mirrors this trip to Google Calendar")).toBeVisible();

  await page.getByLabel("Type the trip name to confirm", { exact: true }).fill("Scratch");
  await page.getByRole("button", { name: "Delete trip", exact: true }).click();
  await expect(page.getByText("That does not match. Type Scratch weekend.")).toBeVisible();
  await expect(page.getByLabel("Type the trip name to confirm", { exact: true })).toBeFocused();

  await page.getByLabel("Type the trip name to confirm", { exact: true }).fill("  scratch WEEKEND ");
  await page.getByRole("button", { name: "Delete trip", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("status")).toHaveText("Trip deleted.");
  await expect(page.getByRole("link", { name: "Scratch weekend", exact: true })).toHaveCount(0);

  await expect.poll(async () => (await page.context().cookies()).some((c) => c.name === "trip-notice" && c.value !== "")).toBe(false);
  await page.reload();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("an editor gets the same 404 as a missing trip on the delete page", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("jacob");
  const response = await page.goto(`/trips/${DECEMBER_TRIP}/settings/delete`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Delete trip")).toHaveCount(0);
});

test("the owner of a shared trip sees who loses access, and the account page is blocked by that trip", async ({ page, signIn }) => {
  await signIn("kenny", `/trips/${DECEMBER_TRIP}/settings/delete`);
  await expect(page.getByText("Jacob Feldman loses access right away.")).toBeVisible();

  await page.goto("/account");
  await expect(page.getByText("You own trips that other people are on.")).toBeVisible();
  await expect(page.locator(`a[href="/trips/${DECEMBER_TRIP}/share"]`)).toHaveText("People on this trip");
  await expect(page.locator(`a[href="/trips/${DECEMBER_TRIP}/settings/delete"]`)).toHaveText("Delete trip");
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0);
});

test("download your data as Jacob: a dated file with his own trips and none of Kenneth's hidden items", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("jacob", "/account");
  await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download your data", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^trip-planner-export-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await readFile(await file.path(), "utf8");
  const data = JSON.parse(text);
  expect(data).toMatchObject({ you: { name: "Jacob Feldman" } });
  expect(Object.keys(data)).toEqual(["exportedAt", "you", "trips"]);
  expect(text).not.toContain("kenny@example.com");
});

test("the home page links to the account page next to Sign out", async ({ page, signIn }) => {
  await signIn("kenny");
  await page.getByRole("link", { name: "Your account", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("Signed in as Kenneth Yu")).toBeVisible();
});
