import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { measureAsync, measureSync, median, MIN_SAMPLES, SAMPLES, TooSlow } from "../../perf/harness";

function spin(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    continue;
  }
}

describe("the perf harness", () => {
  it("takes the same number of samples however fast the function is", () => {
    const quick = measureSync(() => spin(0.01), { name: "quick" });
    const slower = measureSync(() => spin(3), { name: "slower" });
    expect(quick.samples).toBe(SAMPLES);
    expect(slower.samples).toBe(SAMPLES);
    expect(slower.medianMs).toBeGreaterThan(quick.medianMs);
  });

  it("measures the time of one call, not of the batch", () => {
    const { medianMs } = measureSync(() => spin(2), { name: "two milliseconds" });
    expect(medianMs).toBeGreaterThanOrEqual(1.8);
    expect(medianMs).toBeLessThan(6);
  });

  it("stops at the wall clock cap, and a function that cannot give enough samples fails as too slow", () => {
    const started = performance.now();
    expect(() => measureSync(() => spin(40), { name: "far too slow", capMs: 300 })).toThrow(TooSlow);
    expect(performance.now() - started).toBeLessThan(900);
  });

  it("names the measurement and the cap in the failure", () => {
    expect(() => measureSync(() => spin(40), { name: "planCalendarImport/december", capMs: 250 })).toThrow(/planCalendarImport\/december took the whole 250 ms cap and gave only \d+ samples/);
  });

  it("keeps the median when the cap cuts sampling short but enough samples exist", () => {
    const result = measureSync(() => spin(8), { name: "partly capped", capMs: 400, samples: SAMPLES });
    expect(result.samples).toBeGreaterThanOrEqual(MIN_SAMPLES);
    expect(result.samples).toBeLessThan(SAMPLES);
  });

  it("applies the same cap and minimum to async functions", async () => {
    await expect(measureAsync(async () => spin(40), { name: "slow call", capMs: 300 })).rejects.toThrow(TooSlow);
    const ok = await measureAsync(async () => spin(1), { name: "fast call" });
    expect(ok.samples).toBe(SAMPLES);
  });

  it("takes the median of an odd and an even number of values", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });
});
