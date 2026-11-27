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

  it("returns exactly the items the requester may see, and a busy block per hidden item marked busy", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        const oracle = oracleFor(agg, requester);
        if (!oracle.allowed) return;
        const view = projectTrip(agg, requester);
        const expectedIds = agg.items.filter((i) => oracle.seesItem(i)).map((i) => i.id).sort();
        expect(view.items.map((i) => i.id).sort()).toEqual(expectedIds);
        expect(view.busy).toHaveLength(agg.items.filter((i) => !oracle.seesItem(i) && i.showAsBusy).length);
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
