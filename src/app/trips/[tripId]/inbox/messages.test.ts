import { describe, expect, it } from "vitest";
import type { ProposedItem } from "@/domain/import/proposal";
import type { DecidedEntry } from "@/server/services/inbox-service";
import { addAllText, addedOutcome, decidedOutcome, discardedOutcome, ENTRY_GONE, mergedOutcome, entryLabel, savedWithoutRemovedTraveler, type Tapped } from "./messages";

const flight = {
  type: "flight",
  title: "CX509",
  flight: { flightNumber: "CX509", fromAirport: "NRT", toAirport: "HKG" },
} as const satisfies Pick<ProposedItem, "type" | "title" | "flight">;

const entry = (state: DecidedEntry["state"], by: string | null = "Jacob"): DecidedEntry => ({
  state,
  by,
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
    expect(savedWithoutRemovedTraveler(flight)).toEqual({ text: "Added CX509 to Hong Kong without the removed traveler.", role: "status" });
  });
});

describe("the Add all result line", () => {
  it.each([
    [{ added: 4, alreadyDecided: 0, needYou: 0 }, "Added 4."],
    [{ added: 4, alreadyDecided: 1, needYou: 0 }, "Added 4. 1 was already decided by someone else."],
    [{ added: 3, alreadyDecided: 0, needYou: 1 }, "Added 3. 1 still needs you: see below."],
    [{ added: 3, alreadyDecided: 1, needYou: 1 }, "Added 3. 1 was already decided by someone else. 1 still needs you: see below."],
    [{ added: 0, alreadyDecided: 3, needYou: 0 }, "These were already decided by someone else."],
    [{ added: 2, alreadyDecided: 2, needYou: 2 }, "Added 2. 2 were already decided by someone else. 2 still need you: see below."],
    [{ added: 0, alreadyDecided: 0, needYou: 0 }, ""],
  ])("%j", (result, text) => {
    expect(addAllText(result)).toBe(text);
  });
});
