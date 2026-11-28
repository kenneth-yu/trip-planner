import { describe, expect, it } from "vitest";
import { FROZEN_INSTANT, FROZEN_NOW_MS, frozenNow, nowMs, realNow, tick, withRealClock } from "./clock";

describe("the frozen test clock", () => {
  it("starts every test at the frozen instant", () => {
    expect(nowMs()).toBe(FROZEN_NOW_MS);
    expect(frozenNow().toISOString()).toBe(FROZEN_INSTANT);
  });

  it("sits well inside a fifteen minute window and a one minute window", () => {
    const at = frozenNow();
    const minutesIntoWindow = at.getUTCMinutes() % 15;
    expect(Math.min(minutesIntoWindow, 15 - minutesIntoWindow)).toBeGreaterThanOrEqual(5);
    expect(at.getUTCSeconds()).toBe(30);
  });

  it("leaves timers real, so waiting still works while the date stays put", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(nowMs()).toBe(FROZEN_NOW_MS);
  });

  it("moves time on request", () => {
    tick(2000);
    expect(nowMs()).toBe(FROZEN_NOW_MS + 2000);
  });

  it("puts the frozen instant back for the next test", () => {
    expect(nowMs()).toBe(FROZEN_NOW_MS);
  });

  it("gives real time on request and freezes again afterwards", async () => {
    const real = await withRealClock(() => realNow());
    expect(Math.abs(real - FROZEN_NOW_MS)).toBeGreaterThan(0);
    expect(nowMs()).toBe(FROZEN_NOW_MS);
  });
});
