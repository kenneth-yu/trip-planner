import { describe, expect, it } from "vitest";
import { kindsOffAfterSave, LISTED_TIP_KINDS, TIP_KIND_LABELS } from "./kinds";

describe("which kinds Account lists", () => {
  it("lists only the two kinds that have tips today", () => {
    expect([...LISTED_TIP_KINDS]).toEqual(["airport", "bags"]);
  });

  it("words the two kinds that have no tips yet as in the spec", () => {
    expect(TIP_KIND_LABELS.arrival).toBe("Plans right after a long flight");
    expect(TIP_KIND_LABELS.border).toBe("Border crossings");
  });
});

describe("saving the listed kinds", () => {
  it("turns off the listed kinds that are unchecked and keeps unlisted kinds as they were", () => {
    expect(kindsOffAfterSave([], ["airport"])).toEqual(["bags"]);
    expect(kindsOffAfterSave(["sleep", "border"], ["airport", "bags"])).toEqual(["sleep", "border"]);
    expect(kindsOffAfterSave(["bags", "arrival"], ["bags"])).toEqual(["airport", "arrival"]);
  });

  it("ignores values that are not kinds", () => {
    expect(kindsOffAfterSave([], ["airport", "bags", "nonsense"])).toEqual([]);
  });
});
