import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildDemoTrip, PACKED_TRIP } from "@/fixtures/demo-trips";
import { USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { DateTime } from "../time/luxon";
import { fromLocal } from "../time/format";
import type { Item, Requester, TripAggregate } from "../types";
import { projectTrip, type TripView } from "../visibility/project";
import { wrongTime } from "./wrong-time";

const owner: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };

function plan(agg: TripAggregate, title: string): Item {
  return present(agg.items.find((i) => i.title === title), title);
}

function viewWith(agg: TripAggregate, changes: Item[], requester: Requester = owner): TripView {
  const ids = new Set(changes.map((c) => c.id));
  return projectTrip({ ...agg, items: [...agg.items.filter((i) => !ids.has(i.id)), ...changes] }, requester);
}

function moved(item: Item, local: string, zone = item.start.zone, title = item.title): Item {
  const length = Date.parse(item.end.at) - Date.parse(item.start.at);
  const start = fromLocal(local, zone);
  return { ...item, title, start, end: { at: new Date(Date.parse(start.at) + length).toISOString(), zone } };
}

describe("a plan that looks like the wrong am or pm", () => {
  const packed = buildDemoTrip(PACKED_TRIP);
  const gonpachi = plan(packed, "Dinner at Gonpachi");

  it("asks whether Dinner at 6:30am meant 6:30pm, as on the packed week", () => {
    const found = wrongTime(viewWith(packed, [moved(gonpachi, "2027-03-09T06:30")]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "wrong_time", itemId: gonpachi.id, line: "Dinner at 6:30am? Did you mean 6:30pm?" });
    expect(found[0]?.fix?.label).toBe("Change to 6:30pm");
    expect(found[0]?.fix?.done).toBe("Changed to 6:30pm.");
  });

  it("the one tap fix moves the start twelve hours on the wall clock, keeps the length, and the line goes away", () => {
    const slipped = moved(gonpachi, "2027-03-09T06:30");
    const fix = present(wrongTime(viewWith(packed, [slipped]))[0]?.fix);
    expect(fix.start).toEqual(fromLocal("2027-03-09T18:30", "Asia/Tokyo"));
    expect(Date.parse(fix.end.at) - Date.parse(fix.start.at)).toBe(Date.parse(gonpachi.end.at) - Date.parse(gonpachi.start.at));
    expect(fix.end.zone).toBe("Asia/Tokyo");
    expect(wrongTime(viewWith(packed, [{ ...slipped, start: fix.start, end: fix.end }]))).toEqual([]);
  });

  it("explains in both zones with the rule of thumb, as in the spec", () => {
    const found = wrongTime(viewWith(packed, [moved(gonpachi, "2027-03-09T06:00")]));
    expect(found[0]?.why).toBe("Dinner at Gonpachi is set for 6:00am Tokyo time (4:00pm Monday New York). Dinners are rarely that early, so this may be 6:00pm, or a time typed in New York time.");
  });

  it.each([
    ["Dinner at Gonpachi", "2027-03-09T06:59", "Dinner at 6:59am? Did you mean 6:59pm?"],
    ["Supper club", "2027-03-09T01:15", "Supper at 1:15am? Did you mean 1:15pm?"],
    ["Drinks at Golden Gai", "2027-03-09T06:00", "Drinks at 6:00am? Did you mean 6:00pm?"],
    ["Rooftop bar", "2027-03-09T05:30", "Bar at 5:30am? Did you mean 5:30pm?"],
    ["Kabuki show", "2027-03-09T04:00", "Show at 4:00am? Did you mean 4:00pm?"],
    ["Jazz concert", "2027-03-09T03:00", "Concert at 3:00am? Did you mean 3:00pm?"],
    ["Lunch at Toyosu Market", "2027-03-09T04:59", "Lunch at 4:59am? Did you mean 4:59pm?"],
    ["Breakfast at Bills", "2027-03-09T03:00", "Breakfast at 3:00am? Did you mean 3:00pm?"],
    ["Brunch", "2027-03-09T02:00", "Brunch at 2:00am? Did you mean 2:00pm?"],
    ["Dinner", "2027-03-09T00:00", "Dinner at midnight? Did you mean noon?"],
    ["dinner at gonpachi", "2027-03-09T06:30", "Dinner at 6:30am? Did you mean 6:30pm?"],
  ])("%s starting %s reads %j", (title, local, line) => {
    expect(wrongTime(viewWith(packed, [moved(gonpachi, local, "Asia/Tokyo", title)]))[0]?.line).toBe(line);
  });

  it.each([
    ["Dinner at Gonpachi", "2027-03-09T07:00"],
    ["Dinner at Gonpachi", "2027-03-09T19:30"],
    ["Barcelona walking tour", "2027-03-09T10:00"],
    ["Showa Memorial Park", "2027-03-09T10:00"],
    ["Dinnerware shopping", "2027-03-09T10:00"],
  ])("%s starting %s is left alone", (title, local) => {
    expect(wrongTime(viewWith(packed, [moved(gonpachi, local, "Asia/Tokyo", title)]))).toEqual([]);
  });

  it("a lunch at 5:00am is past the am or pm window; at home it raises nothing, and in Tokyo only the zone question", () => {
    expect(wrongTime(viewWith(packed, [moved(gonpachi, "2027-03-09T05:00", "America/New_York", "Lunch")]))).toEqual([]);
    expect(wrongTime(viewWith(packed, [moved(gonpachi, "2027-03-09T05:00", "Asia/Tokyo", "Lunch")]))[0]?.line).toBe("5:00am in Tokyo. Did you mean 5:00am New York time?");
  });

  it("is quiet on the packed week as it stands", () => {
    expect(wrongTime(projectTrip(packed, owner))).toEqual([]);
  });

  it("only looks at plans: a flight, a stay and a transfer at 3am are not plans", () => {
    const others = packed.items.filter((i) => i.type !== "plan").map((i) => moved(i, "2027-03-09T03:00"));
    expect(wrongTime(viewWith(packed, others))).toEqual([]);
  });

  it("keys change when the plan is edited, so a dismissed check returns only for a new edit", () => {
    const first = present(wrongTime(viewWith(packed, [moved(gonpachi, "2027-03-09T06:30")]))[0]);
    const again = present(wrongTime(viewWith(packed, [moved(gonpachi, "2027-03-09T06:30")]))[0]);
    const edited = present(wrongTime(viewWith(packed, [{ ...moved(gonpachi, "2027-03-09T06:00"), updatedAt: "2027-01-01T00:00:00.000Z" }]))[0]);
    expect(again.key).toBe(first.key);
    expect(edited.key).not.toBe(first.key);
  });
});

describe("a plan that looks like it was typed in home time", () => {
  const packed = buildDemoTrip(PACKED_TRIP);
  const gonpachi = plan(packed, "Dinner at Gonpachi");

  it("says so for a Museum at 3:00am on a Tokyo day, because 3:00am Tokyo is 1:00pm in New York", () => {
    const found = wrongTime(viewWith(packed, [moved(gonpachi, "2027-03-09T03:00", "Asia/Tokyo", "Museum")]));
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe("3:00am in Tokyo. Did you mean 3:00am New York time?");
    expect(found[0]?.fix?.label).toBe("Use New York time");
  });

  it("the fix reads the same clock digits in the home zone and keeps the plan in its own zone", () => {
    const fix = present(wrongTime(viewWith(packed, [moved(gonpachi, "2027-03-09T03:00", "Asia/Tokyo", "Museum")]))[0]?.fix);
    expect(fix.start.zone).toBe("Asia/Tokyo");
    expect(fix.start.at).toBe(DateTime.fromISO("2027-03-09T03:00", { zone: "America/New_York" }).toUTC().toISO());
    expect(fix.done).toBe("Changed to 3:00am New York time.");
  });

  it("explains in both zones", () => {
    const found = wrongTime(viewWith(packed, [moved(gonpachi, "2027-03-09T03:00", "Asia/Tokyo", "Museum")]));
    expect(found[0]?.why).toBe("Museum is set for 3:00am Tokyo time (1:00pm Monday New York). That is early for a plan, so this may be a time typed in New York time.");
  });

  it.each([
    ["Asia/Tokyo", "2027-03-09T00:00", true],
    ["Asia/Tokyo", "2027-03-09T05:59", true],
    ["Asia/Tokyo", "2027-03-09T06:00", false],
    ["Asia/Hong_Kong", "2027-03-09T03:00", true],
    ["Europe/London", "2027-03-09T03:00", true],
    ["Europe/London", "2027-03-09T05:30", false],
    ["America/New_York", "2027-03-09T03:00", false],
    ["America/Los_Angeles", "2027-03-09T03:00", false],
  ])("a plain plan in %s starting %s: flagged is %s", (zone, local, flagged) => {
    expect(wrongTime(viewWith(packed, [moved(gonpachi, local, zone, "Museum")])).length > 0).toBe(flagged);
  });

  it("prefers the am or pm question when the title names a meal", () => {
    const found = wrongTime(viewWith(packed, [moved(gonpachi, "2027-03-09T03:00", "Asia/Tokyo")]));
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe("Dinner at 3:00am? Did you mean 3:00pm?");
  });

  it("the am or pm why leaves out the home time when both zones read the same", () => {
    const home = { ...packed, items: packed.items.map((i) => (i.id === gonpachi.id ? moved(i, "2027-03-09T06:00", "America/New_York") : i)) };
    expect(wrongTime(projectTrip(home, owner))[0]?.why).toBe("Dinner at Gonpachi is set for 6:00am New York time. Dinners are rarely that early, so this may be 6:00pm.");
  });
});

describe("who sees it and what never fires", () => {
  const packed = buildDemoTrip(PACKED_TRIP);
  const gonpachi = plan(packed, "Dinner at Gonpachi");

  it("a hidden plan is not in the view, so it cannot be flagged to someone who cannot see it", () => {
    const hidden: Item = { ...moved(gonpachi, "2027-03-09T06:30"), visibility: "only_me", createdBy: USERS.jacob.id, updatedBy: USERS.jacob.id };
    expect(wrongTime(viewWith(packed, [hidden]))).toEqual([]);
    expect(wrongTime(viewWith(packed, [hidden], { kind: "member", userId: USERS.jacob.id, homeZone: "America/New_York" }))).toHaveLength(1);
  });

  it("no rule fires on a trip with no matching items, whatever the plans are called and when they happen", () => {
    const harmless = fc.record({
      title: fc.constantFrom("Museum", "Park", "Walk", "Temple", "Market", "Sumo", "Gallery"),
      hour: fc.integer({ min: 6, max: 23 }),
      minute: fc.constantFrom(0, 15, 30, 45),
    });
    fc.assert(
      fc.property(fc.array(harmless, { maxLength: 8 }), (plans) => {
        const items = plans.map((p, i) => moved({ ...gonpachi, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, title: p.title }, `2027-03-09T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`, "America/New_York"));
        expect(wrongTime(projectTrip({ ...packed, items }, owner))).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
