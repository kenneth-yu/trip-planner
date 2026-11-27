import { describe, expect, it } from "vitest";
import { present } from "@/testing/present";
import { buildFixtureTrip, FIXTURE_TODAY, USERS } from "@/fixtures/december-trip";
import { buildDemoTrip, EMPTY_TRIP, PACKED_TRIP, SPARSE_TRIP } from "@/fixtures/demo-trips";
import { runChecks, byImportance } from "@/domain/checks/checks";
import { buildDeadlineLines } from "@/domain/deadlines/deadlines";
import { instantMs } from "@/domain/time/format";
import { buildTripGrid, dayStrip } from "@/domain/timeline/trip-grid";
import { projectTrip } from "@/domain/visibility/project";
import type { Requester, TripAggregate } from "@/domain/types";
import { checksForTripPage, gridChecks, phoneAlert, withoutHiddenBubbles } from "./attention";
import { anchorOf, type OpenCheck } from "./services/check-service";

const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: USERS.kenny.homeZone };
const DAY = 86400_000;
const now = new Date(FIXTURE_TODAY).getTime();

function stateOf(agg: TripAggregate, at = now) {
  const view = projectTrip(agg, kenny);
  const open: OpenCheck[] = byImportance(runChecks(view)).map((f) => ({ ...f, anchor: anchorOf(view.trip.id, f.key) }));
  const start = view.items.length ? Math.min(...view.items.map((i) => instantMs(i.start))) : null;
  return { view, open, start, at };
}

describe("which checks reach the trip page", () => {
  it("December starts in under 14 days, so every check does", () => {
    const s = stateOf(buildFixtureTrip());
    expect(s.open.length).toBeGreaterThan(0);
    expect(checksForTripPage(s.open, s.view, s.start, s.at)).toEqual(s.open);
  });

  it("the packed week is 101 days out: nothing reaches the trip page, everything stays on the deadlines page", () => {
    const s = stateOf(buildDemoTrip(PACKED_TRIP));
    expect(s.open.length).toBeGreaterThan(0);
    expect(checksForTripPage(s.open, s.view, s.start, s.at)).toEqual([]);
  });

  it("Chicago and Lisbon have nothing to select", () => {
    for (const spec of [SPARSE_TRIP, EMPTY_TRIP]) {
      const s = stateOf(buildDemoTrip(spec));
      expect(checksForTripPage(s.open, s.view, s.start, s.at)).toEqual([]);
    }
  });

  it("the window is inclusive at exactly 14 days and closed at 14 days and a millisecond", () => {
    const s = stateOf(buildFixtureTrip());
    const start = present(s.start);
    expect(checksForTripPage(s.open, s.view, start, start - 14 * DAY)).toEqual(s.open);
    expect(checksForTripPage(s.open, { items: [] }, start, start - 14 * DAY - 1)).toEqual([]);
  });

  it("a trip that has started keeps its checks on the trip page", () => {
    const s = stateOf(buildFixtureTrip());
    expect(checksForTripPage(s.open, s.view, present(s.start), present(s.start) + 3 * DAY)).toEqual(s.open);
  });
});

describe("checks the grid already draws", () => {
  const s = stateOf(buildFixtureTrip());
  const grid = present(buildTripGrid(s.view, now));
  const links = gridChecks(s.view, grid, s.open, s.open);

  it("the missing transfer bubble links to its check, which the panel leaves out", () => {
    const missing = grid.travel.flat().filter((t) => t.kind === "missing");
    expect(missing.length).toBeGreaterThan(0);
    for (const m of missing) expect(links.links[m.key]).toMatch(/^[0-9a-f]{16}$/);
    const cityChange = s.open.filter((f) => f.kind === "city_change_no_transport");
    for (const f of cityChange) expect(links.drawn.has(f.anchor)).toBe(true);
    expect(s.open.filter((f) => !links.drawn.has(f.anchor)).map((f) => f.kind)).not.toContain("city_change_no_transport");
  });

  it("a dismissed city change removes its bubble and the day's ring", () => {
    const openWithout = s.open.filter((f) => f.kind !== "city_change_no_transport");
    const hidden = gridChecks(s.view, grid, s.open, openWithout);
    expect(hidden.hidden.size).toBeGreaterThan(0);
    const after = withoutHiddenBubbles(grid, hidden.hidden);
    expect(after.travel.flat().some((t) => t.kind === "missing")).toBe(false);
    const ringBefore = dayStrip(grid).filter((d) => d.needsAttention).length;
    const ringAfter = dayStrip(after).filter((d) => d.needsAttention).length;
    expect(ringAfter).toBeLessThan(ringBefore);
  });
});

describe("the one phone alert", () => {
  const s = stateOf(buildFixtureTrip());
  const lines = buildDeadlineLines(s.view, now);
  const soon = lines.filter((l) => !l.passed && l.warning);

  it("deadlines within 3 days come first, with the right count of the rest", () => {
    expect(soon.length).toBeGreaterThan(0);
    const alert = present(phoneAlert({ deadlines: lines, pending: 1 }, s.open));
    expect(alert.kind).toBe("deadline");
    expect(alert.sentence).toBe(soon[0].sentence);
    expect(alert.more).toBe(soon.length - 1 + s.open.length + 1);
  });

  it("with no deadline soon the inbox comes next, then a check, never counting a dismissed one", () => {
    const later = lines.map((l) => ({ ...l, warning: false }));
    expect(phoneAlert({ deadlines: later, pending: 2 }, s.open)).toMatchObject({ kind: "inbox", more: s.open.length });
    expect(phoneAlert({ deadlines: later, pending: 0 }, s.open)).toMatchObject({ kind: "check", sentence: s.open[0].sentence, more: s.open.length - 1 });
    expect(phoneAlert({ deadlines: later, pending: 0 }, s.open.slice(1))).toMatchObject({ more: s.open.length - 2 });
    expect(phoneAlert({ deadlines: later, pending: 0 }, [])).toBeNull();
  });

  it("when only the inbox remains behind a deadline, the link goes to the inbox", () => {
    const one = lines.filter((l) => l.id === soon[0].id);
    expect(phoneAlert({ deadlines: one, pending: 1 }, [])).toMatchObject({ kind: "deadline", more: 1, moreIsInboxOnly: true });
  });
});
