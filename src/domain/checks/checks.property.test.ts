import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fcParams, forbiddenStrings, oracleFor, scenario } from "@/testing/arbitraries";
import { projectTrip } from "../visibility/project";
import { runChecks } from "./checks";

const json = (x: unknown) => JSON.stringify(x);

describe("runChecks properties", () => {
  it("never mentions a hidden item, a sensitive value or a link visitor's user id", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        const out = json(runChecks(projectTrip(agg, requester)));
        for (const forbidden of forbiddenStrings(agg, requester)) expect(out).not.toContain(forbidden);
      }),
      fcParams(300),
    );
  });

  it("only points at items the requester can see", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        const view = projectTrip(agg, requester);
        const visible = new Set(view.items.map((i) => i.id));
        for (const f of runChecks(view)) for (const id of f.itemIds) expect(visible.has(id)).toBe(true);
      }),
      fcParams(300),
    );
  });

  it("reports nothing to people who may not see deadlines and checks", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        const oracle = oracleFor(agg, requester);
        if (!oracle.allowed) return;
        const view = projectTrip(agg, requester);
        if (!view.permissions.canSeeDeadlines) expect(runChecks(view)).toEqual([]);
      }),
      fcParams(200),
    );
  });

  it("drops dismissed findings and nothing else, and gives the same answer twice", () => {
    fc.assert(
      fc.property(scenario, fc.nat(5), ({ agg, requester }, dropCount) => {
        if (!oracleFor(agg, requester).allowed) return;
        const view = projectTrip(agg, requester);
        const all = runChecks(view);
        expect(runChecks(view)).toEqual(all);
        const dismissed = new Set(all.slice(0, dropCount).map((f) => f.key));
        const rest = runChecks(view, { dismissedKeys: dismissed });
        expect(rest).toEqual(all.filter((f) => !dismissed.has(f.key)));
      }),
      fcParams(200),
    );
  });
});
