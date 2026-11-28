import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

test("the long flight to Tokyo has a sleep tip with Why?, and the same line is on the flight page", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}?day=2026-12-01`);
  const line = "Sleep tip: from 8:00pm Tokyo time (6:00am New York), about 8 hours.";
  await expect(kenny.getByText(line).filter({ visible: true }).first()).toBeVisible();

  const why = kenny.getByRole("button", { name: `Why? ${line}` }).filter({ visible: true }).first();
  expect((await why.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await why.click();
  await expect(why).toHaveAttribute("aria-expanded", "true");
  await expect(kenny.getByText(/^To shift toward Tokyo time, stay awake until about 8:00pm Tokyo time/).filter({ visible: true }).first()).toBeVisible();
  await expect(kenny.getByText("Meals are usually served about 1 to 2 hours after takeoff and about 1½ to 2 hours before landing.").filter({ visible: true }).first()).toBeVisible();
  await expect(kenny.getByText("General guidance, not medical advice.").filter({ visible: true }).first()).toBeVisible();
  const results = await new AxeBuilder({ page: kenny }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  await kenny.getByRole("link", { name: /NH159/ }).filter({ visible: true }).first().click();
  await expect(kenny.getByText(line).first()).toBeVisible();
});

test("Hide tips like this on the sleep tip turns sleep tips off, says so, and Account turns them back on", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}?day=2026-12-01`);
  const line = "Sleep tip: from 8:00pm Tokyo time (6:00am New York), about 8 hours.";
  await kenny.getByRole("button", { name: `Why? ${line}` }).filter({ visible: true }).first().click();
  await kenny.getByRole("button", { name: "Hide tips like this" }).filter({ visible: true }).first().click();
  const message = kenny.getByRole("status").filter({ hasText: "Sleep tips are off. Turn them back on in Account." });
  await expect(message).toBeVisible();
  await expect(message.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account#travel-smarts");
  await expect(kenny.getByText(line)).toHaveCount(0);

  await message.getByRole("link", { name: "Account" }).click();
  const section = kenny.locator("#travel-smarts");
  await expect(section.getByLabel("Sleep on long flights")).not.toBeChecked();
  await section.getByLabel("Sleep on long flights").check();
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-01`);
  await expect(kenny.getByText(line).filter({ visible: true }).first()).toBeVisible();
});
