import { present } from "@/testing/present";
import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byFlight, byTitle, fixtureItem, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { projectTrip } from "../visibility/project";
import { fromLocal } from "../time/format";
import type { Requester, TripAggregate } from "../types";
import { buildMirrorEvents, planMirrorSync, type MirroredRecord } from "./calendar-mirror";

const NY = "America/New_York";
const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: NY };
const opts = { includeSensitive: false, appUrl: "https://trips.example" };
const eventsFor = (agg: TripAggregate, r: Requester = kenny, o = opts) => buildMirrorEvents(projectTrip(agg, r), o);

describe("building mirror events", () => {
  const events = eventsFor(buildFixtureTrip());
  const byKey = (id: string) => present(events.find((e) => e.key === `item:${id}`)).event;

  it("one event per visible item", () => {
    expect(events).toHaveLength(buildFixtureTrip().items.length);
  });

  it("flights start and end in their own airport zones, local wall clock time", () => {
    const nh159 = byKey(fixtureItem(buildFixtureTrip(), byFlight("NH159")).id);
    expect(nh159.summary).toBe("NH159 New York to Tokyo");
    expect(nh159.start).toEqual({ dateTime: "2026-12-01T00:55:00-05:00", timeZone: "America/New_York" });
    expect(nh159.end).toEqual({ dateTime: "2026-12-02T05:25:00+09:00", timeZone: "Asia/Tokyo" });
    expect(nh159.description).toContain("Lands the next day. Clocks go forward 14 hours.");
  });

  it("never sets reminders and leaves stays as free time", () => {
    expect(events.every((e) => e.event.reminders.useDefault === false && e.event.reminders.overrides.length === 0)).toBe(true);
    const resol = byKey(fixtureItem(buildFixtureTrip(), byTitle("Hotel Resol")).id);
    expect(resol.transparency).toBe("transparent");
  });

  it("leaves out codes and seats unless asked", () => {
    expect(JSON.stringify(events)).not.toMatch(/PLACEHOLDER|30K/);
    const withCodes = eventsFor(buildFixtureTrip(), kenny, { ...opts, includeSensitive: true });
    expect(JSON.stringify(withCodes)).toContain("Kenneth Yu: Confirmation PLACEHOLDER_A, Seat 30K");
  });

  it("a viewer's mirror never has sensitive fields, even if asked", () => {
    const agg = buildFixtureTrip();
    agg.memberships.push({ tripId: TRIP_ID, userId: "user-mom", role: "viewer" });
    const out = eventsFor(agg, { kind: "member", userId: "user-mom", homeZone: NY }, { ...opts, includeSensitive: true });
    expect(JSON.stringify(out)).not.toMatch(/PLACEHOLDER|30K|30C/);
  });

  it("hidden items: nothing, or a plain Busy block with no trace of the item", () => {
    const agg = buildFixtureTrip();
    const base = fixtureItem(agg, byTitle("Jantzen"));
    agg.items.push({
      ...base, id: "item-secret", title: "Ring shopping", createdBy: USERS.jacob.id, visibility: "only_me", showAsBusy: true,
      start: fromLocal("2026-12-05T20:00", "Asia/Hong_Kong"), end: fromLocal("2026-12-05T21:00", "Asia/Hong_Kong"),
    });
    const out = eventsFor(agg);
    expect(JSON.stringify(out)).not.toMatch(/Ring|item-secret/);
    expect(out.filter((e) => e.event.summary === "Busy")).toHaveLength(1);
    present(agg.items.at(-1)).showAsBusy = false;
    expect(eventsFor(agg).some((e) => e.event.summary === "Busy")).toBe(false);
  });
});

describe("planning a sync", () => {
  it("first sync creates everything, a second sync does nothing", () => {
    const desired = eventsFor(buildFixtureTrip());
    const first = planMirrorSync(desired, []);
    expect(first.every((o) => o.op === "create")).toBe(true);
    const mirrored: MirroredRecord[] = desired.map((d, i) => ({ key: d.key, hash: d.hash, googleEventId: `g${i}` }));
    expect(planMirrorSync(desired, mirrored)).toEqual([]);
  });

  it("an edit becomes one update, a deletion one delete", () => {
    const agg = buildFixtureTrip();
    const desired = eventsFor(agg);
    const mirrored: MirroredRecord[] = desired.map((d, i) => ({ key: d.key, hash: d.hash, googleEventId: `g${i}` }));
    const cx509 = fixtureItem(agg, byFlight("CX509"));
    cx509.start = fromLocal("2026-12-05T09:00", "Asia/Tokyo");
    agg.items = agg.items.filter((i) => !i.title.startsWith("Stay at Total"));
    const ops = planMirrorSync(eventsFor(agg), mirrored);
    expect(ops.map((o) => [o.op, o.key])).toEqual([
      ["update", `item:${cx509.id}`],
      ["delete", expect.stringMatching(/^item:/)],
    ]);
  });
});
