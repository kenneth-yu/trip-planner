import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { addPlan, DECEMBER_TRIP } from "./trips";

async function expectNoLeak(kenny: Page, secret: string, day: string): Promise<void> {
  for (const path of [`/trips/${DECEMBER_TRIP}`, `/trips/${DECEMBER_TRIP}?day=${day}`, `/trips/${DECEMBER_TRIP}?day=all`, `/trips/${DECEMBER_TRIP}/deadlines`, `/trips/${DECEMBER_TRIP}/inbox`, "/"]) {
    await kenny.goto(path);
    await expect(kenny.locator("main")).toBeVisible();
    expect(await kenny.content()).not.toContain(secret);
  }
}

test("an Only me plan never shows its title to the other traveler, and Show as busy shows only Busy", async ({ pageSignedInAs }) => {
  const secret = "Surprise dinner for Kenny";
  const jacob = await pageSignedInAs("jacob", `/trips/${DECEMBER_TRIP}`);
  await addPlan(jacob, DECEMBER_TRIP, { title: secret, date: "2026-12-03", starts: "19:00", ends: "21:00", onlyMe: true });
  await expect(jacob.getByText(secret).filter({ visible: true }).first()).toBeVisible();

  const kenny = await pageSignedInAs("kenny", `/trips/${DECEMBER_TRIP}?day=2026-12-03`);
  await expect(kenny.getByRole("heading", { name: "Asia, December 2026" })).toBeVisible();
  await expectNoLeak(kenny, secret, "2026-12-03");

  const busySecret = `${secret} part two`;
  await addPlan(jacob, DECEMBER_TRIP, { title: busySecret, date: "2026-12-04", starts: "18:00", ends: "19:00", onlyMe: true, showAsBusy: true });
  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-04`);
  await expect(kenny.getByText("Busy", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expectNoLeak(kenny, secret, "2026-12-04");
  await expectNoLeak(kenny, busySecret, "2026-12-04");
});
