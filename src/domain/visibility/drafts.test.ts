import { describe, expect, it } from "vitest";
import { buildFixtureTrip, FIXTURE_TODAY, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { buildDeadlineLines } from "../deadlines/deadlines";
import { buildMirrorEvents } from "../mirror/calendar-mirror";
import type { Item, Requester, TripAggregate } from "../types";
import { projectTrip } from "./project";

const kenny: Requester = { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" };
const jacob: Requester = { kind: "member", userId: USERS.jacob.id, homeZone: "America/New_York" };
const visitor: Requester = { kind: "link", homeZone: "America/New_York" };

function draftOf(base: Item, title: string, extra: Partial<Item> = {}): Item {
  return {
    ...base,
    id: `00000000-0000-4000-8400-0000000009${title.length.toString().padStart(2, "0")}`,
    title,
    booked: false,
    deadlines: base.deadlines.map((d) => ({ ...d, id: `${d.id}-draft`, consequence: `${title} consequence` })),
    private: [{ travelerId: null, confirmationCode: `${title}-CODE`, seat: "99Z" }],
    ...extra,
  };
}

function withDrafts(): { agg: TripAggregate; plain: Item; hiddenBusy: Item } {
  const agg = buildFixtureTrip();
  const base = present(agg.items.find((i) => i.type === "plan" && i.deadlines.length === 0) ?? agg.items.find((i) => i.type === "plan"));
  const withDeadline = present(agg.items.find((i) => i.deadlines.length > 0));
  const plain = draftOf({ ...base, deadlines: withDeadline.deadlines }, "Draft sushi dinner");
  const hiddenBusy = draftOf(base, "Draft surprise", { visibility: "only_me", showAsBusy: true, createdBy: USERS.jacob.id });
  return { agg: { ...agg, items: [...agg.items, plain, hiddenBusy], shareLink: { enabled: true, showsDeadlines: true } }, plain, hiddenBusy };
}

const as = (agg: TripAggregate, userId: string, role: "owner" | "editor" | "viewer"): TripAggregate => ({
  ...agg,
  memberships: agg.memberships.map((m) => (m.userId === userId ? { ...m, role } : m)),
});

describe("draft items never leave the people planning the trip", () => {
  const { agg, plain } = withDrafts();

  it("owners and editors see them, marked as not booked", () => {
    for (const who of [kenny, jacob]) {
      const seen = projectTrip(agg, who).items.find((i) => i.id === plain.id);
      expect(seen?.booked).toBe(false);
    }
  });

  it("invited viewers do not see them, and nothing about them is in what a viewer is sent", () => {
    const view = projectTrip(as(agg, USERS.jacob.id, "viewer"), jacob);
    expect(view.items.some((i) => i.booked === false)).toBe(false);
    const text = JSON.stringify(view);
    for (const secret of ["Draft sushi dinner", "Draft surprise", "Draft sushi dinner-CODE", "99Z", "Draft sushi dinner consequence"]) expect(text).not.toContain(secret);
  });

  it("view link visitors do not see them either", () => {
    const view = projectTrip(agg, visitor);
    expect(view.items.some((i) => i.booked === false)).toBe(false);
    const text = JSON.stringify(view);
    for (const secret of ["Draft sushi dinner", "Draft surprise", "99Z"]) expect(text).not.toContain(secret);
  });

  it("a draft marked Show as busy never becomes a busy block for anyone", () => {
    for (const view of [projectTrip(agg, kenny), projectTrip(as(agg, USERS.jacob.id, "viewer"), jacob), projectTrip(agg, visitor)]) {
      const surprise = Date.parse(present(agg.items.find((i) => i.title === "Draft surprise")).start.at);
      expect(view.busy.some((b) => Date.parse(b.start.at) <= surprise && surprise < Date.parse(b.end.at) && view.items.every((i) => i.title !== "Draft surprise"))).toBe(false);
    }
  });

  it("drafts carry no deadlines: none are listed, even for the owner", () => {
    const lines = buildDeadlineLines(projectTrip(agg, kenny), Date.parse(FIXTURE_TODAY));
    expect(lines.some((l) => l.sentence.includes("Draft"))).toBe(false);
    expect(lines.length).toBe(buildDeadlineLines(projectTrip(buildFixtureTrip(), kenny), Date.parse(FIXTURE_TODAY)).length);
  });

  it("the calendar mirror skips them, and includes one the moment it is marked booked", () => {
    const view = projectTrip(agg, kenny);
    const before = buildMirrorEvents(view, { includeSensitive: false, appUrl: "https://trips.test" }).map((e) => e.event.summary);
    expect(before.some((t) => t.includes("Draft"))).toBe(false);
    const booked = { ...agg, items: agg.items.map((i) => (i.id === plain.id ? { ...i, booked: true } : i)) };
    const after = buildMirrorEvents(projectTrip(booked, kenny), { includeSensitive: false, appUrl: "https://trips.test" }).map((e) => e.event.summary);
    expect(after.some((t) => t.includes("Draft sushi dinner"))).toBe(true);
  });
});
