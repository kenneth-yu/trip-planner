import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DECEMBER_TRIP } from "./trips";

const CONNECT = `/trips/${DECEMBER_TRIP}/connect`;

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test("a member makes a calendar link, sees it once, and the feed holds no code, seat or price", async ({ pageSignedInAs, playwright }) => {
  const jacob = await pageSignedInAs("jacob", CONNECT);
  const section = jacob.locator("section", { has: jacob.getByRole("heading", { name: "Calendar subscription" }) });
  await expect(section.getByRole("button", { name: "Make a calendar link" })).toBeVisible();
  expect(await seriousViolations(jacob)).toEqual([]);

  await section.getByRole("button", { name: "Make a calendar link" }).click();
  await expect(section.getByText("Here is your calendar link.")).toBeFocused();
  const link = await section.getByLabel("Calendar link").inputValue();
  expect(link).toMatch(/\/api\/feed\/tpf_[A-Za-z0-9_-]{43}\.ics$/);
  expect(await seriousViolations(jacob)).toEqual([]);

  const request = await playwright.request.newContext();
  const feed = await request.get(link);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  const body = await feed.text();
  expect(body).toContain("SUMMARY:NH159 to Tokyo");
  expect(body).toContain("DTSTART;TZID=America/New_York:20261201T005500");
  expect(body).not.toMatch(/PLACEHOLDER|SEAT|30K|30C|confirmation/i);

  await jacob.reload();
  const again = jacob.locator("section", { has: jacob.getByRole("heading", { name: "Calendar subscription" }) });
  await expect(again.getByText(/^Calendar link made /)).toBeVisible();
  await expect(again.getByText("Not read by a calendar app yet.").or(again.getByText(/^Last read by a calendar app/))).toBeVisible();
  await expect(jacob.locator("body")).not.toContainText("tpf_");
  expect(await seriousViolations(jacob)).toEqual([]);

  await again.getByRole("button", { name: "Make a new link" }).click();
  await expect(again.getByRole("button", { name: "Keep" })).toBeFocused();
  expect(await seriousViolations(jacob)).toEqual([]);
  await again.getByRole("button", { name: "Make new link" }).click();
  await expect(again.getByText("Here is your calendar link.")).toBeVisible();
  expect((await request.get(link)).status()).toBe(404);
  const next = await again.getByLabel("Calendar link").inputValue();
  expect((await request.get(next)).status()).toBe(200);

  await jacob.reload();
  const last = jacob.locator("section", { has: jacob.getByRole("heading", { name: "Calendar subscription" }) });
  await last.getByRole("button", { name: "Turn off" }).click();
  await last.getByRole("button", { name: "Turn off" }).click();
  await expect(last.getByText("Calendar link turned off.")).toBeVisible();
  expect((await request.get(next)).status()).toBe(404);
  await request.dispose();
});
