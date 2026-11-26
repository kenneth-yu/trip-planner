import { describe, expect, it } from "vitest";
import { buildFixtureTrip, byTitle, fixtureItem, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { fromLocal } from "../time/format";
import { projectTrip } from "../visibility/project";
import type { Requester } from "../types";
import { runChecks } from "./checks";

const NY = "America/New_York";
const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: NY };
const sentences = (agg = buildFixtureTrip(), r: Requester = kenny) => runChecks(projectTrip(agg, r)).map((f) => f.sentence);

describe("checks on the fixture trip", () => {
  const found = sentences();

  it("finds exactly the expected problems", () => {
    expect(found).toEqual([
      "Two stays overlap Dec 10 to 13: Airbnb, 528 Nathan Road and 'Stay at Total (USD) $1,183.22'. Check whether one is a duplicate.",
      "Two stays overlap Dec 13 to 14: Stay at Total (USD) $1,183.22 and 'Hotel Resol Ueno'. Check whether one is a duplicate.",
      "You land at Haneda on Dec 2 but fly out of Narita on Dec 5.",
      "You land at Narita on Dec 13 but fly out of Haneda on Dec 15.",
      "Nothing booked to get from Hong Kong to Shenzhen on Dec 6.",
      "Nothing booked to get from Shenzhen to Hong Kong on Dec 10.",
      "Your head spa ends at 9:00pm and Hotel Resol Ueno asks to be told about arrivals after 9:00pm. Check in first or let them know.",
    ]);
  });

  it("dismissing hides a finding until an involved item changes", () => {
    const agg = buildFixtureTrip();
    const first = runChecks(projectTrip(agg, kenny))[0];
    expect(runChecks(projectTrip(agg, kenny), { dismissedKeys: new Set([first.key]) })).toHaveLength(found.length - 1);
    fixtureItem(agg, byTitle("Airbnb")).updatedAt = "2026-11-27T00:00:00.000Z";
    expect(runChecks(projectTrip(agg, kenny), { dismissedKeys: new Set([first.key]) })).toHaveLength(found.length);
  });

  it("a viewer without deadlines sees no checks", () => {
    const agg = buildFixtureTrip();
    agg.memberships.push({ tripId: TRIP_ID, userId: "user-mom", role: "viewer" });
    expect(sentences(agg, { kind: "member", userId: "user-mom", homeZone: NY })).toEqual([]);
  });
});

describe("hidden items in checks", () => {
  function withHidden(showAsBusy: boolean) {
    const agg = buildFixtureTrip();
    const base = fixtureItem(agg, byTitle("Jantzen"));
    agg.items.push({
      ...base, id: "item-secret", title: "Ring shopping", createdBy: USERS.jacob.id, visibility: "only_me", showAsBusy,
      start: fromLocal("2026-12-05T17:30", "Asia/Hong_Kong"), end: fromLocal("2026-12-05T18:00", "Asia/Hong_Kong"),
    });
    return agg;
  }
  it("a busy block only says you have something else", () => {
    const s = sentences(withHidden(true));
    expect(s).toContain("You have something else at 5:30pm.");
    expect(s.join(" ")).not.toContain("Ring");
  });
  it("a hidden item not shown as busy is ignored entirely", () => {
    expect(sentences(withHidden(false))).toEqual(sentences());
  });
});

describe("other checks", () => {
  it("nowhere to sleep, plan outside places and tight connection", () => {
    const agg = buildFixtureTrip();
    agg.items = agg.items.filter((i) => !i.title.startsWith("Mumian"));
    const jantzen = fixtureItem(agg, byTitle("Jantzen"));
    jantzen.start = fromLocal("2026-12-05T14:30", "Asia/Hong_Kong");
    const s = sentences(agg);
    expect(s).toContain("Nowhere booked for the night of Dec 8 in Hong Kong.");
    expect(s).toContain("You land at 1:25pm and your next plan is at 2:30pm. That may be tight after immigration.");
    const agg2 = buildFixtureTrip();
    const tailor = fixtureItem(agg2, byTitle("Jantzen"));
    tailor.start = fromLocal("2026-12-07T17:00", "Asia/Hong_Kong");
    tailor.end = fromLocal("2026-12-07T18:00", "Asia/Hong_Kong");
    expect(sentences(agg2)).toContain("Jantzen Tailor is in Hong Kong, but you are in Shenzhen at 5:00pm on Dec 7.");
  });
});
