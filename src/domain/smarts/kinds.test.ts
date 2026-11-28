import { describe, expect, it } from "vitest";
import { kindsOffAfterSave, LISTED_TIP_KINDS, TIP_KIND_LABELS } from "./kinds";

describe("which kinds Account lists", () => {
  it("lists only the kinds that have tips today, worded as the UX lead asked", () => {
    expect([...LISTED_TIP_KINDS]).toEqual(["airport", "bags", "sleep"]);
    expect(TIP_KIND_LABELS.bags).toBe("Storing bags around check-in and check-out");
    expect(TIP_KIND_LABELS.sleep).toBe("Sleep on long flights");
  });

  it("words the kinds that have no tips yet as in the spec", () => {
    expect(TIP_KIND_LABELS.arrival).toBe("Plans right after a long flight");
    expect(TIP_KIND_LABELS.border).toBe("Border crossings");
  });
});

describe("saving the listed kinds", () => {
  it("turns off the listed kinds that are unchecked and keeps unlisted kinds as they were", () => {
    expect(kindsOffAfterSave([], ["airport", "sleep"])).toEqual(["bags"]);
    expect(kindsOffAfterSave(["arrival", "border"], ["airport", "bags", "sleep"])).toEqual(["arrival", "border"]);
    expect(kindsOffAfterSave(["bags", "arrival"], ["bags"])).toEqual(["airport", "sleep", "arrival"]);
  });

  it("ignores values that are not kinds", () => {
    expect(kindsOffAfterSave([], ["airport", "bags", "sleep", "nonsense"])).toEqual([]);
  });
});
