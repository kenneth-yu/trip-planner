import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { expectedBusyIntervals, fcParams, forbiddenStrings, instantMsArb, oracleFor, scenario } from "@/testing/arbitraries";
import { runChecks } from "../checks/checks";
import { buildDays } from "../time/days";
import { buildDeadlineLines } from "../deadlines/deadlines";
import { projectTrip } from "../visibility/project";
import { buildTripGrid, dayStrip, upNext } from "./trip-grid";

const json = (x: unknown) => JSON.stringify(x);
const withNow = fc.tuple(scenario, instantMsArb);

describe("view builders for any requester", () => {
  it("buildDays, buildTripGrid, dayStrip, upNext and buildDeadlineLines never leak", () => {
    fc.assert(
      fc.property(withNow, ([{ agg, requester }, now]) => {
        if (!oracleFor(agg, requester).allowed) return;
        const view = projectTrip(agg, requester);
        const grid = buildTripGrid(view, now);
        const out = json([buildDays(view), grid, grid ? dayStrip(grid) : null, upNext(view, now, 10), buildDeadlineLines(view, now)]);
        for (const forbidden of forbiddenStrings(agg, requester)) expect(out).not.toContain(forbidden);
      }),
      fcParams(300),
    );
  });

  it("deadline lines exist only when allowed, one per visible deadline", () => {
    fc.assert(
      fc.property(withNow, ([{ agg, requester }, now]) => {
        const oracle = oracleFor(agg, requester);
        if (!oracle.allowed) return;
        const lines = buildDeadlineLines(projectTrip(agg, requester), now);
        const expected = oracle.canSeeDeadlines ? agg.items.filter((i) => oracle.seesItem(i) && i.booked).reduce((n, i) => n + i.deadlines.length, 0) : 0;
        expect(lines).toHaveLength(expected);
        expect(lines.map((l) => l.at)).toEqual([...lines.map((l) => l.at)].sort());
        for (const l of lines) expect(l.passed).toBe(new Date(l.at).getTime() <= now);
      }),
      fcParams(300),
    );
  });

  it("days are consecutive calendar dates and every visible item appears on one", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        const view = projectTrip(agg, requester);
        const days = buildDays(view);
        for (let i = 1; i < days.length; i++) {
          const gap = (Date.parse(`${days[i].key}T00:00:00Z`) - Date.parse(`${days[i - 1].key}T00:00:00Z`)) / 86_400_000;
          expect(gap).toBe(1);
        }
        const placed = new Set(days.flatMap((d) => d.entries.flatMap((e) => ("itemId" in e ? [e.itemId] : []))));
        for (const item of view.items) expect(placed.has(item.id)).toBe(true);
        expect(days.flatMap((d) => d.entries.filter((e) => e.kind === "busy"))).toHaveLength(view.busy.length);
        expect(view.busy.map((b) => [b.start.at, b.end.at])).toEqual(expectedBusyIntervals(agg, requester));
        expect(runChecks(view).filter((f) => f.kind === "busy_overlap").length).toBeLessThanOrEqual(view.busy.length * Math.max(view.items.length, 1));
      }),
      fcParams(300),
    );
  });

  it("the grid has one row per day, and the day strip matches it", () => {
    fc.assert(
      fc.property(withNow, ([{ agg, requester }, now]) => {
        if (!oracleFor(agg, requester).allowed) return;
        const view = projectTrip(agg, requester);
        const grid = buildTripGrid(view, now);
        if (!grid) {
          expect(buildDays(view)).toEqual([]);
          return;
        }
        expect(grid.travel).toHaveLength(grid.days.length);
        expect(grid.plans).toHaveLength(grid.days.length);
        const strip = dayStrip(grid);
        expect(strip.map((d) => d.key)).toEqual(grid.days.map((d) => d.key));
        expect(grid.days.filter((d) => d.today).length).toBeLessThanOrEqual(1);
      }),
      fcParams(300),
    );
  });

  it("upNext lists only confirmed things that have not happened yet, soonest first, within the count", () => {
    fc.assert(
      fc.property(withNow, fc.integer({ min: 1, max: 6 }), ([{ agg, requester }, now], count) => {
        if (!oracleFor(agg, requester).allowed) return;
        const view = projectTrip(agg, requester);
        const entries = upNext(view, now, count);
        expect(entries.length).toBeLessThanOrEqual(count);
        const confirmedIds = view.items.filter((i) => i.status === "confirmed").map((i) => i.id);
        for (const e of entries) expect(confirmedIds.some((id) => e.key.endsWith(id))).toBe(true);
      }),
      fcParams(200),
    );
  });
});
