import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

const IDEAS = `/trips/${DECEMBER_TRIP}/ideas`;

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test("ideas are captured, recalled on the city's days, scheduled, finished and dropped, with axe clean throughout", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", IDEAS);
  await expect(kenny.getByRole("heading", { name: "Ideas", exact: true })).toBeVisible();
  expect(await seriousViolations(kenny)).toEqual([]);

  await kenny.getByRole("button", { name: "Add an idea" }).click();
  await kenny.getByLabel("What").fill("Buy gold");
  await kenny.getByLabel("Where").fill("Shenzhen");
  await kenny.getByRole("button", { name: "Add idea" }).click();
  await expect(kenny.getByRole("status").filter({ hasText: "Added to ideas for Shenzhen." })).toBeVisible();
  await expect(kenny.getByRole("heading", { name: /^Shenzhen, Dec 6 to 10$/ })).toBeVisible();

  await kenny.getByRole("button", { name: "Add an idea" }).click();
  await kenny.getByLabel("What").fill("Try the local beer");
  await kenny.getByRole("button", { name: "Add idea" }).click();
  await expect(kenny.getByRole("heading", { name: "Anywhere" })).toBeVisible();

  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-08`);
  const line = kenny.getByRole("button", { name: "1 idea for Shenzhen" }).first();
  await expect(line).toHaveAttribute("aria-expanded", "false");
  expect((await line.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await line.click();
  await expect(kenny.getByText("Buy gold").first()).toBeVisible();
  expect(await seriousViolations(kenny)).toEqual([]);
  await expect(kenny.getByRole("button", { name: /idea.* for (Hong Kong|Tokyo)/ })).toHaveCount(0);

  await kenny.goto(IDEAS);
  await kenny.getByRole("button", { name: "Buy gold" }).click();
  await expect(kenny.getByRole("button", { name: "Schedule it" })).toBeFocused();
  expect(await seriousViolations(kenny)).toEqual([]);
  await kenny.getByRole("button", { name: "Schedule it" }).click();
  await expect(kenny.getByText("Free time in Shenzhen")).toBeVisible();
  const choice = kenny.getByRole("button", { name: /all day$/ }).first();
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  expect(await seriousViolations(kenny)).toEqual([]);
  await kenny.getByRole("button", { name: "Schedule it" }).last().click();
  await expect(kenny.getByRole("status").filter({ hasText: /^Scheduled Buy gold for / })).toBeVisible();
  await expect(kenny.getByRole("button", { name: "Buy gold" })).toHaveCount(0);

  await kenny.getByRole("button", { name: "Try the local beer" }).click();
  await kenny.getByRole("button", { name: "Did it" }).click();
  await expect(kenny.getByRole("status").filter({ hasText: "Marked Try the local beer as done." })).toBeVisible();
  await kenny.getByText("Done (1)").click();
  await expect(kenny.getByRole("button", { name: "Not done" })).toBeVisible();
  expect(await seriousViolations(kenny)).toEqual([]);
});

test("the Add page leads to the idea form, with focus on What and the choice of who can see it", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}/add`);
  await kenny.getByRole("link", { name: "Not sure when yet? Save it as an idea" }).click();
  await expect(kenny.getByLabel("What")).toBeFocused();
  await expect(kenny.getByRole("group", { name: "Who can see this" })).toBeVisible();
  expect(await seriousViolations(kenny)).toEqual([]);
});

test("a dropped idea comes back with Undo, and nothing is left open for the other specs", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", IDEAS);
  await kenny.getByRole("button", { name: "Add an idea" }).click();
  await kenny.getByLabel("What").fill("Massage");
  await kenny.getByLabel("Where").fill("Shenzhen");
  await kenny.getByLabel("Only me").check();
  await kenny.getByRole("button", { name: "Add idea" }).click();
  await kenny.getByRole("button", { name: "Massage" }).click();
  await kenny.getByRole("button", { name: "Drop it" }).click();
  await expect(kenny.getByRole("status").filter({ hasText: "Dropped Massage." })).toBeVisible();
  await kenny.getByRole("button", { name: "Undo" }).click();
  await expect(kenny.getByRole("button", { name: "Massage" })).toBeVisible();
  await kenny.getByRole("button", { name: "Massage" }).click();
  await kenny.getByRole("button", { name: "Drop it" }).click();
  await expect(kenny.getByRole("status").filter({ hasText: "Dropped Massage." })).toBeVisible();
});

test("a schedule that fails keeps its form open with what was typed, next to the error", async ({ pageSignedInAs }) => {
  const kenny = await pageSignedInAs("kenny", IDEAS);
  await kenny.getByRole("button", { name: "Add an idea" }).click();
  await kenny.getByLabel("What").fill("Silver shopping");
  await kenny.getByLabel("Where").fill("Shenzhen");
  await kenny.getByLabel("Only me").check();
  await kenny.getByRole("button", { name: "Add idea" }).click();
  await kenny.getByRole("button", { name: "Silver shopping" }).click();
  await kenny.getByRole("button", { name: "Schedule it" }).click();
  await kenny.getByLabel("Starts").fill("2026-12-08T15:00");
  await kenny.getByLabel("Ends").fill("2026-12-08T14:00");
  await kenny.getByRole("button", { name: "Schedule it" }).last().click();
  await expect(kenny.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
  await expect(kenny.getByLabel("Starts")).toHaveValue("2026-12-08T15:00");
  await expect(kenny.getByLabel("Ends")).toHaveValue("2026-12-08T14:00");
  await kenny.getByLabel("Ends").fill("2026-12-08T16:00");
  await kenny.getByRole("button", { name: "Schedule it" }).last().click();
  await expect(kenny.getByRole("status").filter({ hasText: /^Scheduled Silver shopping for / })).toBeVisible();
  await expect(kenny.getByRole("button", { name: "Silver shopping" })).toHaveCount(0);
});

test("the other member never sees an only me idea", async ({ pageSignedInAs }) => {
  const jacob = await pageSignedInAs("jacob", IDEAS);
  await expect(jacob.getByText("Buy gold")).toHaveCount(0);
  await expect(jacob.getByText("Massage")).toHaveCount(0);
});
