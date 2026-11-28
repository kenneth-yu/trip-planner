import { describe, expect, it } from "vitest";
import { buildFixtureTrip, TRAVELERS, USERS } from "@/fixtures/december-trip";
import { inputToProposal } from "./quick-add";
import { editPatch, entriesOfValues, itemToFormValues, MESSAGES, parseEditForm, parseItemForm, type FormEntries } from "./item-form";
import { projectTrip, type VisibleItem } from "../visibility/project";

const trip = buildFixtureTrip();
const places = { homeZone: "America/New_York" };
const owner = { kind: "member" as const, userId: USERS.kenny.id, homeZone: "America/New_York" };
const view = projectTrip(trip, owner);

const stayEntries: FormEntries = [
  ["type", "stay"],
  ["name", "Hotel Resol Ueno"],
  ["place", "Tokyo"],
  ["checkInDate", "2027-01-16"],
  ["checkOutDate", "2027-01-27"],
];

function minutesOf(extra: FormEntries) {
  const r = parseItemForm([...stayEntries, ...extra]);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.input.type === "stay" ? r.input.timeToAirportMinutes : "not a stay";
}

describe("about how long to the airport", () => {
  it("turns hours and minutes into total minutes", () => {
    expect(minutesOf([["toAirportHours", "1"], ["toAirportMinutes", "15"]])).toBe(75);
    expect(minutesOf([["toAirportHours", ""], ["toAirportMinutes", "45"]])).toBe(45);
    expect(minutesOf([["toAirportHours", "2"]])).toBe(120);
  });

  it("is simply absent when left blank or zero", () => {
    expect(minutesOf([])).toBeUndefined();
    expect(minutesOf([["toAirportHours", "0"], ["toAirportMinutes", "0"]])).toBeUndefined();
  });

  it.each([["abc", "5"], ["1", "-5"], ["24", "0"], ["1.5", ""]])("asks again for hours %j and minutes %j", (hours, minutes) => {
    const r = parseItemForm([...stayEntries, ["toAirportHours", hours], ["toAirportMinutes", minutes]]);
    if (r.ok) throw new Error("Expected the form to fail");
    expect(r.errors.toAirportHours).toBe(MESSAGES.toAirport);
  });

  it("comes back into the edit form as hours and minutes, and clearing it is a patch", () => {
    const parsed = parseItemForm([...stayEntries, ["toAirportHours", "1"], ["toAirportMinutes", "15"]]);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const proposal = inputToProposal({ ...parsed.input, travelers: [TRAVELERS.kenny] }, view.travelers, places);
    expect(proposal.stay?.timeToAirportMinutes).toBe(75);
    const item: VisibleItem = {
      ...proposal,
      id: "stay-1",
      tripId: view.trip.id,
      visibility: "everyone",
      visibleToUserIds: [],
      showAsBusy: false,
      flags: proposal.problems,
      deadlines: [],
      createdBy: USERS.kenny.id,
      updatedBy: USERS.kenny.id,
      createdAt: "2026-11-20T12:00:00.000Z",
      updatedAt: "2026-11-20T12:00:00.000Z",
    };
    const values = itemToFormValues(item, view.travelers.filter((t) => item.travelerIds.includes(t.id)));
    expect(values.fields).toMatchObject({ toAirportHours: "1", toAirportMinutes: "15" });
    const cleared = parseEditForm(entriesOfValues({ ...values, fields: { ...values.fields, toAirportHours: "", toAirportMinutes: "" } }), { travelerIds: item.travelerIds, previous: item.private });
    if (!cleared.ok) throw new Error(JSON.stringify(cleared.errors));
    const next = inputToProposal({ ...cleared.input, travelers: item.travelerIds }, view.travelers, places);
    const patch = editPatch(item, next, cleared.private);
    expect(patch).toHaveProperty("stay");
    expect(patch.stay?.timeToAirportMinutes).toBeUndefined();
    const unchanged = parseEditForm(entriesOfValues(values), { travelerIds: item.travelerIds, previous: item.private });
    if (!unchanged.ok) throw new Error(JSON.stringify(unchanged.errors));
    expect(editPatch(item, inputToProposal({ ...unchanged.input, travelers: item.travelerIds }, view.travelers, places), unchanged.private)).not.toHaveProperty("stay");
  });
});
