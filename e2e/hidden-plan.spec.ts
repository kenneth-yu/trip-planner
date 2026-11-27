import { expect, pageSignedInAs, test } from "./fixtures";
import { addPlan, DECEMBER_TRIP } from "./trips";

test("an Only me plan never shows its title to the other traveler, and Show as busy shows only Busy", async ({ browser }) => {
  const secret = "Surprise dinner for Kenny";
  const jacob = await pageSignedInAs(browser, "jacob", `/trips/${DECEMBER_TRIP}`);
  await addPlan(jacob, DECEMBER_TRIP, { title: secret, date: "2026-12-03", starts: "19:00", ends: "21:00", onlyMe: true });
  await expect(jacob.getByText(secret).filter({ visible: true }).first()).toBeVisible();

  const kenny = await pageSignedInAs(browser, "kenny", `/trips/${DECEMBER_TRIP}?day=2026-12-03`);
  await expect(kenny.getByRole("heading", { name: "Asia, December 2026" })).toBeVisible();
  expect(await kenny.content()).not.toContain(secret);

  await addPlan(jacob, DECEMBER_TRIP, { title: `${secret} part two`, date: "2026-12-04", starts: "18:00", ends: "19:00", onlyMe: true, showAsBusy: true });
  await kenny.goto(`/trips/${DECEMBER_TRIP}?day=2026-12-04`);
  await expect(kenny.getByText("Busy", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  expect(await kenny.content()).not.toContain(secret);

  await jacob.context().close();
  await kenny.context().close();
});
