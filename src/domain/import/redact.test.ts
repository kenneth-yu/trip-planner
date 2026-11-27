import { describe, expect, it } from "vitest";
import { redactPrivate } from "./patterns";

describe("redactPrivate", () => {
  it("hides codes, seats, prices and phone numbers but keeps the rest readable", () => {
    const out = redactPrivate("ANA NH 159. Reservation PLACEHOLDER_A, seat 30K. Paid USD 412.50 or $99. Call +1 212 555 0100 or 555-0100.");
    expect(out).not.toMatch(/PLACEHOLDER_A|30K|412|\$99|212 555|555-0100/);
    expect(out).toContain("ANA NH 159.");
    expect(out).toContain("Reservation [in private details]");
  });

  it("leaves dates, times and flight numbers alone", () => {
    const text = "Departs 2026-12-01 at 8:50am on CX509. Free cancellation until Dec 2.";
    expect(redactPrivate(text)).toBe(text);
  });

  it("redacts unparsed sentences taken from a description", () => {
    expect(redactPrivate("Confirmation: ZZTOP99 seat 12A.")).not.toMatch(/ZZTOP99|12A/);
  });
});
