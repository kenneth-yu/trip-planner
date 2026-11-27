import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { LISBON_TRIP } from "./trips";

const PACKED_TRIP = "00000000-0000-4000-8300-000000000103";

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

test("an editor sees the name as text and the four travelers, with no delete link", async ({ pageSignedInAs }) => {
  const jacob = await pageSignedInAs("jacob", "/");
  await expect(jacob.getByRole("link", { name: "Settings", exact: true })).toHaveCount(2);
  await jacob.goto(`/trips/${PACKED_TRIP}/settings`);
  await expect(jacob.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(jacob.locator("input[name=name]")).toHaveCount(0);
  await expect(jacob.getByText("Tokyo and Kyoto with friends").first()).toBeVisible();
  const list = jacob.getByRole("list");
  await expect(list.getByRole("button", { name: /Kenneth Yu/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /Jacob Feldman You/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /Maya Chen No account yet/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /Sam Ortiz No account yet/ })).toBeVisible();
  await expect(jacob.getByRole("link", { name: "Delete this trip", exact: true })).toHaveCount(0);
  await expectNoSeriousViolations(jacob);
});

test("the owner renames a trip and sees it in the header, then renames it back", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${LISBON_TRIP}/settings`);
  await kenny.getByLabel("Trip name", { exact: true }).fill("Lisbon in spring");
  await kenny.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(kenny.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await kenny.goto(`/trips/${LISBON_TRIP}`);
  await expect(kenny.getByRole("heading", { name: "Lisbon in spring", exact: true })).toBeVisible();
  await kenny.goto(`/trips/${LISBON_TRIP}/settings`);
  await expect(kenny.getByRole("link", { name: "Delete this trip", exact: true })).toBeVisible();
  await kenny.getByLabel("Trip name", { exact: true }).fill("Lisbon, someday");
  await kenny.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(kenny.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
});

test("removing a traveler who is on items is refused with the visible items named", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${PACKED_TRIP}/settings`);
  await kenny.getByRole("button", { name: /Maya Chen/ }).click();
  await expectNoSeriousViolations(kenny);
  await kenny.getByRole("button", { name: "Remove", exact: true }).click();
  await kenny.getByRole("button", { name: "Remove", exact: true }).click();
  const refusal = kenny.getByRole("alert").filter({ hasText: "Maya Chen is on" });
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText(/and \d+ more\. Take them off those first\./);
  await expectNoSeriousViolations(kenny);
});

test("an editor adds a traveler on an empty trip, sees Added, and removes them again", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${LISBON_TRIP}/settings`);
  await kenny.getByRole("button", { name: "Add traveler", exact: true }).click();
  await expect(kenny.getByText("As it should appear on bookings, like Maya Chen.")).toBeVisible();
  await expectNoSeriousViolations(kenny);
  await kenny.getByLabel("Name", { exact: true }).fill("Maya Chen");
  await kenny.getByRole("button", { name: "Add", exact: true }).click();
  await expect(kenny.getByRole("button", { name: /Maya Chen No account yet Added/ })).toBeVisible();
  await expect(kenny.getByRole("button", { name: "Add traveler", exact: true })).toBeFocused();

  await kenny.getByRole("button", { name: "Add traveler", exact: true }).click();
  await kenny.getByLabel("Name", { exact: true }).fill("maya chen");
  await kenny.getByRole("button", { name: "Add", exact: true }).click();
  await expect(kenny.getByRole("alert").filter({ hasText: "There is already a traveler called maya chen." })).toBeVisible();
  await kenny.getByRole("button", { name: "Cancel", exact: true }).click();

  await kenny.getByRole("button", { name: /Maya Chen/ }).click();
  await kenny.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(kenny.getByText("Remove Maya Chen from the travelers?")).toBeVisible();
  await kenny.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(kenny.getByRole("status").filter({ hasText: "Removed Maya Chen." })).toBeVisible();
});
