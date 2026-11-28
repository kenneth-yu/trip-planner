import { describe, expect, it } from "vitest";
import { buildDemoTrip, PACKED_TRIP } from "@/fixtures/demo-trips";
import { USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { byImportance, runChecks } from "../checks/checks";
import { fromLocal } from "../time/format";
import type { Item, Requester } from "../types";
import { projectTrip } from "../visibility/project";

const owner: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };

function slipped() {
  const packed = buildDemoTrip(PACKED_TRIP);
  const dinner = present(packed.items.find((i) => i.title === "Dinner at Gonpachi"));
  const length = Date.parse(dinner.end.at) - Date.parse(dinner.start.at);
  const start = fromLocal("2027-03-09T06:30", "Asia/Tokyo");
  const moved: Item = { ...dinner, start, end: { at: new Date(Date.parse(start.at) + length).toISOString(), zone: "Asia/Tokyo" } };
  return { packed, moved };
}

describe("smart checks in Worth a look", () => {
  it("run with the rest of the checks, carrying their line, Why? and fix", () => {
    const { packed, moved } = slipped();
    const found = runChecks(projectTrip({ ...packed, items: packed.items.map((i) => (i.id === moved.id ? moved : i)) }, owner)).filter((f) => f.kind === "wrong_time");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sentence: "Dinner at 6:30am? Did you mean 6:30pm?", itemIds: [moved.id] });
    expect(found[0]?.why).toContain("Dinner at Gonpachi is set for 6:30am Tokyo time");
    expect(found[0]?.fix?.label).toBe("Change to 6:30pm");
  });

  it("can be dismissed with This is fine like any check, by key", () => {
    const { packed, moved } = slipped();
    const view = projectTrip({ ...packed, items: packed.items.map((i) => (i.id === moved.id ? moved : i)) }, owner);
    const key = present(runChecks(view).find((f) => f.kind === "wrong_time")).key;
    expect(runChecks(view, { dismissedKeys: new Set([key]) }).some((f) => f.kind === "wrong_time")).toBe(false);
  });

  it("are quiet on the packed week as it stands, and sort after late arrivals and before the older tight connection check", () => {
    const packed = buildDemoTrip(PACKED_TRIP);
    expect(runChecks(projectTrip(packed, owner)).filter((f) => f.kind === "wrong_time" || f.kind === "risky_connection")).toEqual([]);
    const order = byImportance([{ kind: "tight_connection" as const }, { kind: "wrong_time" as const }, { kind: "risky_connection" as const }, { kind: "late_arrival" as const }]);
    expect(order.map((o) => o.kind)).toEqual(["late_arrival", "risky_connection", "wrong_time", "tight_connection"]);
  });

  it("a viewer who may not see deadlines sees no smart checks, like every other check", () => {
    const { packed, moved } = slipped();
    const withViewer = { ...packed, items: packed.items.map((i) => (i.id === moved.id ? moved : i)), memberships: [...packed.memberships, { tripId: packed.trip.id, userId: "00000000-0000-4000-8100-0000000000bb", role: "viewer" as const }] };
    const viewer = projectTrip(withViewer, { kind: "member", userId: "00000000-0000-4000-8100-0000000000bb", homeZone: "America/New_York" });
    expect(runChecks(viewer)).toEqual([]);
  });
});
