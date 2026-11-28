import { describe, expect, it } from "vitest";
import type { ProposedItem } from "@/domain/import/proposal";
import type { DecidedEntry } from "@/server/services/inbox-service";
import { addAllText, addedOutcome, decidedOutcome, discardedOutcome, ENTRY_GONE, mergedOutcome, entryLabel, importedOutcome, savedWithoutRemovedTraveler, type Tapped } from "./messages";

const flight = {
  type: "flight",
  title: "CX509",
  flight: { flightNumber: "CX509", fromAirport: "NRT", toAirport: "HKG" },
} as const satisfies Pick<ProposedItem, "type" | "title" | "flight">;

const entry = (state: DecidedEntry["state"], by: string | null = "Jacob", intoVisible = true): DecidedEntry => ({
  state,
  by,
  intoVisible,
  proposed: { ...flight, start: { at: "2026-12-05T00:00:00.000Z", zone: "Asia/Tokyo" }, end: { at: "2026-12-05T04:00:00.000Z", zone: "Asia/Hong_Kong" }, startIsEstimated: false, endIsEstimated: false, location: null, travelerIds: [], private: [], deadlines: [], notes: "", status: "confirmed", problems: [] },
});

describe("what a tap says when the entry was already decided", () => {
  const table: [Tapped, DecidedEntry["state"], string, "status" | "alert"][] = [
    ["add", "approved", "Jacob already added CX509 to Hong Kong.", "status"],
    ["merge", "merged", "Jacob already merged CX509 to Hong Kong.", "status"],
    ["discard", "discarded", "Jacob already discarded CX509 to Hong Kong.", "status"],
    ["add", "discarded", "Jacob discarded CX509 to Hong Kong, so it was not added. Add it again from its source if you need it.", "alert"],
    ["merge", "discarded", "Jacob discarded CX509 to Hong Kong, so it was not added. Add it again from its source if you need it.", "alert"],
    ["add", "merged", "Jacob merged CX509 to Hong Kong into an item already on the trip, so it was not added twice.", "status"],
    ["merge", "approved", "Jacob added CX509 to Hong Kong as its own item, so nothing was merged. Check the trip for a duplicate.", "alert"],
    ["discard", "approved", "Jacob already added CX509 to Hong Kong. To remove it, open it on the trip and delete it.", "alert"],
    ["discard", "merged", "Jacob already added CX509 to Hong Kong. To remove it, open it on the trip and delete it.", "alert"],
  ];

  it.each(table)("%s on an entry that is now %s", (tapped, state, text, role) => {
    expect(decidedOutcome(tapped, entry(state))).toEqual({ text, role });
  });

  it("does not mention an item already on the trip when the merge target is hidden from the reader", () => {
    expect(decidedOutcome("add", entry("merged", "Jacob", false)).text).toBe("Jacob merged CX509 to Hong Kong, so it was not added twice.");
  });

  it("says You for a double tap", () => {
    expect(decidedOutcome("add", entry("approved", "You")).text).toBe("You already added CX509 to Hong Kong.");
  });

  it("says Someone on the trip when the decider is no longer a member", () => {
    expect(decidedOutcome("add", entry("approved", null)).text).toBe("Someone on the trip already added CX509 to Hong Kong.");
  });

  it("never shows an engine error", () => {
    for (const [tapped, state] of table) expect(decidedOutcome(tapped, entry(state)).text).not.toMatch(/InvalidTransition|no transition/);
  });
});

describe("labels", () => {
  it("names a flight by its destination city and anything else by its title", () => {
    expect(entryLabel(flight)).toBe("CX509 to Hong Kong");
    expect(entryLabel({ type: "plan", title: "Dim sum" })).toBe("Dim sum");
    expect(entryLabel({ type: "flight", title: "XX1", flight: { flightNumber: "XX1", fromAirport: "QQQ", toAirport: "QQQ" } })).toBe("XX1");
  });

  it("announces a plain decision", () => {
    expect(addedOutcome(flight).text).toBe("Added CX509 to Hong Kong.");
    expect(mergedOutcome(flight, "CX509").text).toBe("Merged CX509 to Hong Kong into CX509.");
    expect(discardedOutcome(flight).text).toBe("Discarded CX509 to Hong Kong.");
    expect(ENTRY_GONE).toEqual({ text: "That item is no longer in the inbox.", role: "status" });
  });

  it("says what happened to a removed traveler without naming them", () => {
    expect(savedWithoutRemovedTraveler(flight, null)).toEqual({ text: "Added CX509 to Hong Kong without the removed traveler.", role: "status" });
    expect(savedWithoutRemovedTraveler(flight, "CX509")).toEqual({ text: "Merged CX509 to Hong Kong into CX509 without the removed traveler.", role: "status" });
  });
});

describe("the Add all result line", () => {
  const r = (added: number, alreadyDecided: number, needYou: number, alreadyByYou = 0, withoutRemovedTraveler = 0) => ({ added, alreadyDecided, needYou, alreadyByYou, withoutRemovedTraveler });
  it.each([
    [r(4, 0, 0), "Added 4."],
    [r(4, 1, 0), "Added 4. 1 was already decided by someone else."],
    [r(3, 0, 1), "Added 3. 1 still needs you: see below."],
    [r(3, 1, 1), "Added 3. 1 was already decided by someone else. 1 still needs you: see below."],
    [r(0, 3, 0), "These were already decided by someone else."],
    [r(2, 2, 2), "Added 2. 2 were already decided by someone else. 2 still need you: see below."],
    [r(0, 0, 0, 2), "These were already decided."],
    [r(0, 1, 0, 1), "These were already decided."],
    [r(2, 0, 0, 1), "Added 2. 1 was already decided."],
    [r(3, 0, 0, 0, 1), "Added 3. 1 was saved without a removed traveler."],
    [r(0, 0, 0), ""],
  ])("%j", (result, text) => {
    expect(addAllText(result)).toBe(text);
  });
});

describe("the line after a Google import", () => {
  it.each([
    [["18", "5"], "18 events are waiting in your inbox. 5 look like things already on the trip."],
    [["18", "0"], "18 events are waiting in your inbox."],
    [["1", "1"], "1 event is waiting in your inbox. 1 looks like a thing already on the trip."],
    [["3", undefined], "3 events are waiting in your inbox."],
    [["3", "nonsense"], "3 events are waiting in your inbox."],
    [["3", " 1 "], "3 events are waiting in your inbox."],
    [["3", "1e3"], "3 events are waiting in your inbox."],
    [["3", "0x10"], "3 events are waiting in your inbox."],
  ])("%j", ([imported, matched], text) => {
    expect(importedOutcome(imported, matched)).toEqual({ text, role: "status" });
  });

  it.each([
    [["12", "3", "4"], "12 events are waiting in your inbox. 3 look like things already on the trip. 4 were left out: cancelled, outside your dates, or with no readable time."],
    [["12", "0", "1"], "12 events are waiting in your inbox. 1 was left out: cancelled, outside your dates, or with no readable time."],
    [["12", "3", "0"], "12 events are waiting in your inbox. 3 look like things already on the trip."],
    [["12", "3", "junk"], "12 events are waiting in your inbox. 3 look like things already on the trip."],
    [["12", "3", "1e3"], "12 events are waiting in your inbox. 3 look like things already on the trip."],
    [["0", "0", "2"], "0 events are waiting in your inbox. 2 were left out: cancelled, outside your dates, or with no readable time."],
  ])("with the left out part %j", ([imported, matched, left], text) => {
    expect(importedOutcome(imported, matched, left)).toEqual({ text, role: "status" });
  });

  it.each([[undefined], ["abc"], ["-1"], ["1.5"], [["1", "2"]], ["999999999"], [""], [" 7 "], ["1e3"], ["0x10"], ["+7"], ["７"]])("shows nothing for %j", (imported) => {
    expect(importedOutcome(imported, "0")).toBeNull();
  });
});
