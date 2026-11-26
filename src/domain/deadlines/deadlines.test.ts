import { describe, expect, it } from "vitest";
import { buildFixtureTrip, FIXTURE_TODAY, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { projectTrip } from "../visibility/project";
import { instantMs } from "../time/format";
import { buildDeadlineLines } from "./deadlines";

const NY = "America/New_York";
const now = instantMs(new Date(FIXTURE_TODAY).toISOString());

describe("deadlines on Nov 26, 2026 (phase 3 acceptance)", () => {
  const lines = buildDeadlineLines(projectTrip(buildFixtureTrip(), { kind: "member", userId: USERS.kenny.id, homeZone: NY }), now);

  it("lists all four, sorted by time, with the right warnings", () => {
    expect(lines.map((l) => [l.exact, l.warning])).toEqual([
      ["Sat Nov 28, 11:59pm Tokyo (9:59am Sat NY)", true],
      ["Sun Nov 29, 10:00am Tokyo (8:00pm Sat NY)", true],
      ["Thu Dec 3, 2:00pm Hong Kong (1:00am Thu NY)", false],
      ["Sat Dec 5, 12:00am Shenzhen (11:00am Fri NY)", false],
    ]);
  });

  it("says what happens and how long until", () => {
    expect(lines[0].sentence).toBe("Hotel Resol Ueno becomes non refundable in 2 days");
  });

  it("a viewer with deadlines turned off sees none", () => {
    const agg = buildFixtureTrip();
    agg.memberships.push({ tripId: TRIP_ID, userId: "user-mom", role: "viewer" });
    expect(buildDeadlineLines(projectTrip(agg, { kind: "member", userId: "user-mom", homeZone: NY }), now)).toEqual([]);
  });
});
