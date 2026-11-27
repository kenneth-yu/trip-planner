import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP, LISBON_TRIP } from "./trips";

async function seriousProblems(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

test("Lisbon: Kenneth picks Jacob and gets one link to send, with no accessibility problems", async ({ page, signIn }) => {
  await signIn("kenny", `/trips/${LISBON_TRIP}/share`);
  await expect(page.getByRole("heading", { name: "People from your trips" })).toBeVisible();
  expect(await seriousProblems(page)).toEqual([]);

  await page.getByRole("button", { name: "Jacob Feldman Invite" }).click();
  const line = page.getByText("Send this link to Jacob.");
  await expect(line).toBeVisible();
  await expect(line).toBeFocused();
  await expect(page.getByText("One person can join with this link, as an editor. It expires in 7 days.")).toBeVisible();
  await expect(page.getByText("Editor invite, created")).toBeVisible();
  expect(await seriousProblems(page)).toEqual([]);

  await page.reload();
  await expect(page.getByText("Send this link to Jacob.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "People from your trips" })).toBeVisible();
});

test("December: Jacob is already a member, so Kenneth sees no list", async ({ page, signIn }) => {
  await signIn("kenny", `/trips/${DECEMBER_TRIP}/share`);
  await expect(page.getByRole("heading", { name: "Invite someone" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "People from your trips" })).toHaveCount(0);
  await expect(page.getByText("No one yet")).toHaveCount(0);
  expect(await seriousProblems(page)).toEqual([]);
});

test("Jacob, an editor on December, gets the not found page on Share and no list", async ({ pageSignedInAs }) => {
  const page = await pageSignedInAs("jacob", `/trips/${DECEMBER_TRIP}/share`);
  await expect(page.getByRole("heading", { name: "This page isn't here." })).toBeVisible();
  await expect(page.getByText("People from your trips")).toHaveCount(0);
});
