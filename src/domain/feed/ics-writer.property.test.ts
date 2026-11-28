import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fcParams, forbiddenStrings, markersOf, oracleFor, scenario } from "@/testing/arbitraries";
import { projectTrip } from "../visibility/project";
import { buildFeed } from "./ics-writer";

const opts = { appUrl: "https://trips.test", generatedAt: new Date("2026-11-28T12:00:00Z") };
const unfolded = (feed: string) => feed.replace(/\r\n /g, "");

describe("the calendar feed, for any trip and any member", () => {
  it("never contains a code, seat, phone, price, booking site or note, a hidden item, a blocked deadline or a user id", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester, kind }) => {
        if (kind !== "member" || !oracleFor(agg, requester).allowed) return;
        const text = unfolded(buildFeed(projectTrip(agg, requester), opts));
        const forbidden = [
          ...forbiddenStrings(agg, requester),
          ...agg.items.flatMap((item) => markersOf(item).sensitive),
          ...agg.items.map((item) => markersOf(item).identifying[6] ?? ""),
          ...agg.memberships.map((m) => m.userId),
          ...agg.travelers.flatMap((t) => (t.userId ? [t.userId] : [])),
        ].filter((value) => value.length > 0);
        for (const value of forbidden) expect(text).not.toContain(value);
      }),
      fcParams(300),
    );
  });

  it("has one event for each visible item, each busy block and each deadline the member may see, and no other kind of line", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester, kind }) => {
        if (kind !== "member" || !oracleFor(agg, requester).allowed) return;
        const view = projectTrip(agg, requester);
        const text = buildFeed(view, opts);
        const deadlines = view.permissions.canSeeDeadlines ? view.items.reduce((sum, item) => sum + item.deadlines.length, 0) : 0;
        expect(text.split("BEGIN:VEVENT\r\n").length - 1).toBe(view.items.length + view.busy.length + deadlines);
        for (const line of unfolded(text).split("\r\n")) {
          if (line === "") continue;
          expect(line).toMatch(/^(BEGIN|END|VERSION|PRODID|CALSCALE|METHOD|X-WR-CALNAME|REFRESH-INTERVAL|X-PUBLISHED-TTL|TZID|DTSTART|DTEND|TZOFFSETFROM|TZOFFSETTO|TZNAME|UID|DTSTAMP|SUMMARY|LOCATION|DESCRIPTION|CLASS|TRANSP)[:;]/);
        }
      }),
      fcParams(300),
    );
  });

  it("writes a busy block as Busy and nothing else", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester, kind }) => {
        if (kind !== "member" || !oracleFor(agg, requester).allowed) return;
        const text = unfolded(buildFeed(projectTrip(agg, requester), opts));
        for (const block of text.split("BEGIN:VEVENT\r\n").slice(1)) {
          if (!block.includes("SUMMARY:Busy\r\n")) continue;
          expect(block).not.toMatch(/LOCATION|DESCRIPTION/);
          expect(block).toContain("CLASS:PRIVATE\r\n");
          expect(block).toContain("TRANSP:OPAQUE\r\n");
        }
      }),
      fcParams(300),
    );
  });

  it("keeps every line within 75 octets and every event id unique", () => {
    fc.assert(
      fc.property(scenario, ({ agg, requester, kind }) => {
        if (kind !== "member" || !oracleFor(agg, requester).allowed) return;
        const text = buildFeed(projectTrip(agg, requester), opts);
        for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
        const uids = [...unfolded(text).matchAll(/UID:([^\r]+)/g)].map((m) => m[1]);
        expect(new Set(uids).size).toBe(uids.length);
      }),
      fcParams(300),
    );
  });
});
