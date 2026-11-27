import { describe, expect, it } from "vitest";
import { duplicateMessage, nameKey, relationOf, relationText, sameName } from "./names";
import { removalRefusal, type BlockingItem, type RefusalSegment } from "./removal";

const item = (id: string, title: string, extra: Partial<BlockingItem> = {}): BlockingItem => ({ id, title, flightNumber: null, hasSeat: false, ...extra });
const flat = (segments: RefusalSegment[]) => segments.map((s) => ("item" in s ? s.item.label : s.text)).join("");
const NOZOMI = item("1", "Nozomi 17 to Kyoto");
const ACE = item("2", "Ace Hotel Kyoto");
const SENSO = item("3", "Senso-ji");
const GINZA = item("4", "Tonkatsu at Maisen");
const MORI = item("5", "Mori Art Museum");

describe("the removal refusal copy", () => {
  it("names one item", () => {
    expect(flat(removalRefusal("Maya Chen", [NOZOMI]))).toBe("Maya Chen is on Nozomi 17 to Kyoto. Take them off it first.");
  });

  it("names two and three items", () => {
    expect(flat(removalRefusal("Maya Chen", [NOZOMI, ACE]))).toBe("Maya Chen is on Nozomi 17 to Kyoto and Ace Hotel Kyoto. Take them off those first.");
    expect(flat(removalRefusal("Maya Chen", [NOZOMI, ACE, SENSO]))).toBe("Maya Chen is on Nozomi 17 to Kyoto, Ace Hotel Kyoto and Senso-ji. Take them off those first.");
  });

  it("names two and counts the rest from four on", () => {
    expect(flat(removalRefusal("Maya Chen", [NOZOMI, ACE, SENSO, GINZA]))).toBe("Maya Chen is on Nozomi 17 to Kyoto, Ace Hotel Kyoto and 2 more. Take them off those first.");
    expect(flat(removalRefusal("Maya Chen", [NOZOMI, ACE, SENSO, GINZA, MORI]))).toBe("Maya Chen is on Nozomi 17 to Kyoto, Ace Hotel Kyoto and 3 more. Take them off those first.");
  });

  it("links each named item to its id", () => {
    expect(removalRefusal("Maya Chen", [NOZOMI, ACE]).filter((s) => "item" in s)).toEqual([{ item: { id: "1", label: "Nozomi 17 to Kyoto" } }, { item: { id: "2", label: "Ace Hotel Kyoto" } }]);
  });

  it("uses the seat sentence for a single flight with their seat", () => {
    const nh159 = item("9", "NH159 JFK to Haneda", { flightNumber: "NH159", hasSeat: true });
    expect(flat(removalRefusal("Kenny Yu", [nh159]))).toBe("Kenny's seat is on NH159. Remove it from that flight first.");
  });

  it("says only that something remains when nothing visible is left, with no title and no count", () => {
    expect(flat(removalRefusal("Maya Chen", []))).toBe("Maya Chen is still on something on this trip. Ask whoever added it to take them off.");
  });
});

describe("traveler names", () => {
  it("compares names without case or spacing", () => {
    expect(nameKey("  Maya   CHEN ")).toBe("maya chen");
    expect(sameName("Maya Chen", "maya  chen")).toBe(true);
    expect(sameName("Maya Chen", "Maya Chan")).toBe(false);
    expect(duplicateMessage("  maya   chen ")).toBe("There is already a traveler called maya chen.");
  });

  const members = [
    { userId: "k", name: "Kenneth Yu" },
    { userId: "j", name: "Jacob Feldman" },
  ];

  it("says You, the account name only when it differs, nothing when matching, and No account yet", () => {
    expect(relationText(relationOf({ name: "Kenneth Yu", userId: "k" }, members, "k"))).toBe("You");
    expect(relationText(relationOf({ name: "Jake", userId: "j" }, members, "k"))).toBe("Jacob Feldman's account");
    expect(relationText(relationOf({ name: "jacob feldman", userId: "j" }, members, "k"))).toBeNull();
    expect(relationText(relationOf({ name: "Maya Chen", userId: null }, members, "k"))).toBe("No account yet");
    expect(relationText(relationOf({ name: "Ghost", userId: "gone" }, members, "k"))).toBe("No account yet");
  });
});
