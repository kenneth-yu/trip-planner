import { describe, expect, it } from "vitest";
import { buildFixtureTrip, USERS } from "@/fixtures/december-trip";
import { projectTrip } from "./project";
import { calendarItems } from "./calendar-items";

const kenny = { kind: "member" as const, userId: USERS.kenny.id, homeZone: "America/New_York" };

describe("the items that belong in a calendar", () => {
  it("are the booked ones, and an item is in again the moment it is booked", () => {
    const agg = buildFixtureTrip();
    const first = agg.items[0];
    if (!first) throw new Error("no items");
    first.booked = false;
    const out = calendarItems(projectTrip(agg, kenny)).map((i) => i.id);
    expect(out).not.toContain(first.id);
    expect(out).toHaveLength(agg.items.length - 1);
    first.booked = true;
    expect(calendarItems(projectTrip(agg, kenny)).map((i) => i.id)).toContain(first.id);
  });
});
