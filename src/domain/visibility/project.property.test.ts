import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fcParams, forbiddenStrings, oracleFor, scenario } from "@/testing/arbitraries";
import { AccessDenied, projectTrip } from "./project";

const json = (x: unknown) => JSON.stringify(x);

describe("projectTrip properties", () => {
  it("throws AccessDenied exactly when the requester has no access", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        const oracle = oracleFor(agg, requester);
        if (oracle.allowed) expect(() => projectTrip(agg, requester)).not.toThrow();
        else expect(() => projectTrip(agg, requester)).toThrow(AccessDenied);
      }),
      fcParams(300),
    );
  });

  it("never serializes a hidden item, a sensitive value, a blocked deadline or a link visitor's user ids", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        const out = json(projectTrip(agg, requester));
        for (const forbidden of forbiddenStrings(agg, requester)) expect(out).not.toContain(forbidden);
      }),
      fcParams(300),
    );
  });

  it("returns exactly the items the requester may see, and one busy block per distinct interval of hidden items marked busy", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        const oracle = oracleFor(agg, requester);
        if (!oracle.allowed) return;
        const view = projectTrip(agg, requester);
        const expectedIds = agg.items.filter((i) => oracle.seesItem(i)).map((i) => i.id).sort();
        expect(view.items.map((i) => i.id).sort()).toEqual(expectedIds);
        const intervals = new Set(agg.items.filter((i) => !oracle.seesItem(i) && i.showAsBusy).map((i) => `${i.start.at}|${i.end.at}`));
        expect(view.busy).toHaveLength(intervals.size);
        expect(new Set(view.busy.map((b) => b.key)).size).toBe(view.busy.length);
      }),
      fcParams(300),
    );
  });

  it("busy blocks carry only a key, a start and an end", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        for (const b of projectTrip(agg, requester).busy) {
          expect(Object.keys(b).sort()).toEqual(["end", "key", "start"]);
          expect(Object.keys(b.start).sort()).toEqual(["at", "zone"]);
          expect(Object.keys(b.end).sort()).toEqual(["at", "zone"]);
        }
      }),
      fcParams(300),
    );
  });

  it("busy blocks are placed in a zone the requester already knows, never the hidden item's", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        const view = projectTrip(agg, requester);
        const known = new Set([requester.homeZone, ...view.items.flatMap((i) => [i.start.zone, i.end.zone])]);
        for (const b of view.busy) {
          expect(known.has(b.start.zone)).toBe(true);
          expect(known.has(b.end.zone)).toBe(true);
        }
      }),
      fcParams(300),
    );
  });

  it("shows who an item is shared with only to its creator", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed || requester.kind !== "member") return;
        for (const item of projectTrip(agg, requester).items) {
          const source = agg.items.find((i) => i.id === item.id);
          expect(item.visibleToUserIds).toEqual(source?.createdBy === requester.userId ? source.visibleToUserIds : []);
        }
      }),
      fcParams(300),
    );
  });

  it("a removed member gets AccessDenied even when they created or were listed on items", () => {
    fc.assert(
      fc.property(scenario, ({ agg }) => {
        const removed = agg.memberships[agg.memberships.length - 1].userId;
        const withoutThem = { ...agg, memberships: agg.memberships.filter((m) => m.userId !== removed) };
        const requester = { kind: "member" as const, userId: removed, homeZone: "America/New_York" };
        expect(() => projectTrip(withoutThem, requester)).toThrow(AccessDenied);
      }),
      fcParams(200),
    );
  });

  it("strips private rows and deadlines exactly when the requester may not see them", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        const oracle = oracleFor(agg, requester);
        if (!oracle.allowed) return;
        const view = projectTrip(agg, requester);
        for (const item of view.items) {
          const source = agg.items.find((i) => i.id === item.id);
          expect(item.private).toHaveLength(oracle.canSeeSensitive ? (source?.private.length ?? 0) : 0);
          expect(item.deadlines).toHaveLength(oracle.canSeeDeadlines ? (source?.deadlines.length ?? 0) : 0);
        }
        expect(view.permissions.canSeeSensitive).toBe(oracle.canSeeSensitive);
        expect(view.permissions.canSeeDeadlines).toBe(oracle.canSeeDeadlines);
      }),
      fcParams(300),
    );
  });

  it("does not mutate the aggregate it projects", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        const before = structuredClone(agg);
        projectTrip(agg, requester);
        expect(agg).toEqual(before);
      }),
      fcParams(150),
    );
  });
});
