import { describe, it } from "vitest";
import type { CalendarEvent } from "@/domain/import/calendar-event";
import { buildFixtureTrip, fixture, TRAVELERS, USERS } from "@/fixtures/december-trip";
import { buildDemoTrip, PACKED_TRIP } from "@/fixtures/demo-trips";
import { runChecks } from "@/domain/checks/checks";
import { planCalendarImport } from "@/domain/import/pipeline";
import { buildTripGrid } from "@/domain/timeline/trip-grid";
import { buildDays } from "@/domain/time/days";
import { projectTrip } from "@/domain/visibility/project";
import type { Requester, TripAggregate } from "@/domain/types";
import { budgets } from "./budgets";
import { check, measureSync } from "./harness";

const owner: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: USERS.kenny.homeZone };
const NOW = Date.parse(fixture.today);

const trips: { label: string; agg: TripAggregate }[] = [
  { label: "december", agg: buildFixtureTrip() },
  { label: "packed", agg: buildDemoTrip(PACKED_TRIP) },
];

function budgetFor(name: string): number {
  const entry = budgets.hotPaths[name];
  if (!entry) throw new Error(`Add "${name}" to hotPaths in perf/budgets.json with a measured budget.`);
  return entry.budgetMs;
}

describe.each(trips)("hot paths on the $label trip", ({ label, agg }) => {
  const view = projectTrip(agg, owner);
  const run = (name: string, fn: () => unknown) => {
    it(`${name} stays inside its budget`, () => {
      const key = `${name}/${label}`;
      const budgetMs = budgetFor(key);
      check("hot-paths", key, measureSync(fn, { name: key, target: { name: key, file: "hot-paths", budgetMs } }), budgetMs);
    });
  };

  run("projectTrip", () => projectTrip(agg, owner));
  run("buildTripGrid", () => buildTripGrid(view, NOW));
  run("buildDays", () => buildDays(view));
  run("runChecks", () => runChecks(view));
  run("planCalendarImport", () =>
    planCalendarImport(fixture.calendarEvents, view.items, {
      calendarTravelers: { "kenny primary": [TRAVELERS.kenny], "shared China": [TRAVELERS.kenny, TRAVELERS.jacob] },
      defaultTravelerIds: [TRAVELERS.kenny],
      homeZone: owner.homeZone,
    }),
  );
});

describe("an import at the size limit", () => {
  const events: CalendarEvent[] = Array.from({ length: 500 }, (_, i) => ({ summary: `Event ${i}`, start: { dateTime: "2026-12-05T10:00:00Z" }, end: { dateTime: "2026-12-05T11:00:00Z" } }));

  it("planCalendarImport on 500 events at one moment stays inside its budget", () => {
    const view = projectTrip(buildDemoTrip(PACKED_TRIP), owner);
    const run = () => planCalendarImport(events, view.items, { calendarTravelers: {}, defaultTravelerIds: [TRAVELERS.kenny], homeZone: owner.homeZone });
    check("hot-paths", "planCalendarImport/500events", measureSync(run, { samples: 11, batch: 2, warmup: 3 }), budgetFor("planCalendarImport/500events"), 11);
  });
});
