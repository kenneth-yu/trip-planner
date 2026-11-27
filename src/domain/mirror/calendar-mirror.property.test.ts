import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fcParams, forbiddenStrings, markersOf, oracleFor, scenario } from "@/testing/arbitraries";
import { projectTrip } from "../visibility/project";
import { buildMirrorEvents } from "./calendar-mirror";

const json = (x: unknown) => JSON.stringify(x);
const options = (includeSensitive: boolean) => ({ includeSensitive, appUrl: "https://trips.test" });

describe("buildMirrorEvents properties", () => {
  it("never writes a hidden item, a blocked sensitive value or a link visitor's user id into an event", () => {
    fc.assert(
      fc.property(scenario, fc.boolean(), ({ agg, requester }, includeSensitive) => {
        if (!oracleFor(agg, requester).allowed) return;
        const out = json(buildMirrorEvents(projectTrip(agg, requester), options(includeSensitive)));
        for (const forbidden of forbiddenStrings(agg, requester)) expect(out).not.toContain(forbidden);
      }),
      fcParams(300),
    );
  });

  it("leaves every sensitive value out when sensitive details are not requested", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        const out = json(buildMirrorEvents(projectTrip(agg, requester), options(false)));
        for (const item of agg.items) for (const value of markersOf(item).sensitive) expect(out).not.toContain(value);
      }),
      fcParams(300),
    );
  });

  it("makes one event per visible item and per distinct busy interval, with unique keys", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        const view = projectTrip(agg, requester);
        const events = buildMirrorEvents(view, options(false));
        const distinctBusy = new Set(view.busy.map((b) => `${b.start.at}|${b.end.at}`)).size;
        expect(events).toHaveLength(view.items.length + distinctBusy);
        expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
      }),
      fcParams(200),
    );
  });

  it("busy events carry only the times", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        const busy = buildMirrorEvents(projectTrip(agg, requester), options(true)).filter((e) => e.key.startsWith("busy:"));
        for (const b of busy) {
          expect(b.event.summary).toBe("Busy");
          expect(b.event.description).toBe("");
          expect(b.event.location).toBeUndefined();
          expect(b.event.source).toBeUndefined();
        }
      }),
      fcParams(200),
    );
  });

  it("produces the same hashes when built twice", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester }) => {
        if (!oracleFor(agg, requester).allowed) return;
        const view = projectTrip(agg, requester);
        expect(buildMirrorEvents(view, options(false))).toEqual(buildMirrorEvents(view, options(false)));
      }),
      fcParams(100),
    );
  });
});
