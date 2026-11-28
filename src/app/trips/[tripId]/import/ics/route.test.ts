import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { toIcs } from "@/testing/ics-fixture";
import { testContext } from "@/server/testing";
import { listInbox } from "@/server/services/inbox-service";
import type { ServiceContext } from "@/server/services/context";
import { kenny } from "@/server/testing";
import { POST } from "./route";
import { ProblemCode, problemFor, problemFromQuery, problemQuery, problemText } from "./problems";
import { BadDates, NothingInDates, TooManyEvents } from "@/server/import/ics-import";
import { FetchRefused } from "@/server/import/fetch-guard";
import { IcsProblem } from "@/domain/import/ics";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null; user: { id: string; homeZone: string } | null } = { ctx: null, user: null };
  return state;
});

vi.mock("@/server/auth/session", () => ({ currentUser: async () => world.user }));
vi.mock("@/server/app-context", () => ({
  requestContext: async () => {
    if (!world.ctx) throw new Error("no test context");
    return world.ctx;
  },
}));

const calendar = toIcs(fixture.calendarEvents.slice(0, 6));

function post(form: FormData, headers: Record<string, string> = {}, tripId = TRIP_ID) {
  const request = new Request(`https://trips.test/trips/${tripId}/import/ics`, { method: "POST", body: form, headers: { origin: "https://trips.test", host: "trips.test", ...headers } });
  return POST(request, { params: Promise.resolve({ tripId }) });
}

function fileForm(text: string, name = "trip.ics") {
  const form = new FormData();
  form.set("file", new File([text], name, { type: "text/calendar" }));
  return form;
}

function location(response: Response): string {
  return response.headers.get("location") ?? "";
}

describe("the .ics upload route", () => {
  beforeEach(async () => {
    world.ctx = (await testContext({ withItems: false })).ctx;
    world.user = { id: USERS.kenny.id, homeZone: USERS.kenny.homeZone };
  });

  it("imports the file into the review inbox and answers with counts only", async () => {
    const response = await post(fileForm(calendar));
    expect(response.status).toBe(303);
    expect(location(response)).toMatch(new RegExp(`^/trips/${TRIP_ID}/inbox\\?imported=\\d+&matched=\\d+&left=0$`));
    const inbox = await listInbox(present(world.ctx), TRIP_ID, kenny);
    expect(inbox.length).toBeGreaterThan(0);
    expect(location(response)).not.toContain("trip.ics");
  });

  it.each([
    ["a cross site form", { origin: "https://evil.example.test" }],
    ["a form from a different host", { origin: "https://trips.test.evil.example" }],
  ])("refuses %s before reading it, and imports nothing", async (_name, headers) => {
    const response = await post(fileForm(calendar), headers);
    expect(response.status).toBe(403);
    expect(await listInbox(present(world.ctx), TRIP_ID, kenny)).toEqual([]);
  });

  it("refuses a request that says it came from another site when it sends no origin", async () => {
    const response = await post(fileForm(calendar), { origin: "", "sec-fetch-site": "cross-site" });
    expect(response.status).toBe(403);
  });

  it("sends a signed out person to sign in, with the page to come back to", async () => {
    world.user = null;
    const response = await post(fileForm(calendar));
    expect(location(response)).toBe(`/sign-in?next=${encodeURIComponent(`/trips/${TRIP_ID}/import`)}`);
    expect(await listInbox(present(world.ctx), TRIP_ID, kenny)).toEqual([]);
  });

  it("answers a person who is not on the trip like a missing trip, and stores nothing", async () => {
    world.user = { id: "00000000-0000-4000-8100-0000000000fd", homeZone: "UTC" };
    const response = await post(fileForm(calendar));
    expect(location(response)).toBe("/not-on-your-account");
    expect(await listInbox(present(world.ctx), TRIP_ID, kenny)).toEqual([]);
  });

  it("answers a bad trip id with 404", async () => {
    expect((await post(fileForm(calendar), {}, "not-a-uuid")).status).toBe(404);
  });

  it.each([
    ["no file at all", new FormData(), "no_file"],
    ["an empty file", fileForm(""), "no_file"],
    ["a file that is not a calendar", fileForm("just words"), "not_calendar"],
    ["a file over 2 MB", fileForm("x".repeat(2 * 1024 * 1024 + 1)), "too_big"],
  ])("%s goes back to the page with a fixed problem code", async (_name, form, code) => {
    const response = await post(form);
    expect(location(response)).toBe(`/trips/${TRIP_ID}/import?problem=${code}`);
  });

  it("reads an upload with no declared length only up to the cap, then stops", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(512 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 40) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body,
      duplex: "half",
      headers: { origin: "https://trips.test", host: "trips.test", "content-type": "multipart/form-data; boundary=x" },
    };
    const request = new Request(`https://trips.test/trips/${TRIP_ID}/import/ics`, init);
    expect(request.headers.get("content-length")).toBeNull();
    const response = await POST(request, { params: Promise.resolve({ tripId: TRIP_ID }) });
    expect(location(response)).toBe(`/trips/${TRIP_ID}/import?problem=too_big`);
    expect(pulled).toBeLessThan(10);
  });

  it("a body that is not a form goes back to the page, not to an error", async () => {
    const request = new Request(`https://trips.test/trips/${TRIP_ID}/import/ics`, {
      method: "POST",
      body: "not a multipart body",
      headers: { origin: "https://trips.test", host: "trips.test", "content-type": "multipart/form-data; boundary=x" },
    });
    const response = await POST(request, { params: Promise.resolve({ tripId: TRIP_ID }) });
    expect(location(response)).toBe(`/trips/${TRIP_ID}/import?problem=no_file`);
  });

  it("a link is refused while its rate limit rule does not exist, and nothing is fetched", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const form = new FormData();
    form.set("link", "https://calendar.example.test/SECRETTOKEN.ics");
    const response = await post(form);
    expect(location(response)).toBe(`/trips/${TRIP_ID}/import?problem=link_failed`);
    expect(location(response)).not.toContain("SECRETTOKEN");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("the dates in the upload", () => {
  beforeEach(async () => {
    world.ctx = (await testContext({ withItems: false })).ctx;
    world.user = { id: USERS.kenny.id, homeZone: USERS.kenny.homeZone };
  });

  const two = toIcs([
    { summary: "Dinner at Girl and the Goat", start: { dateTime: "2026-12-05T19:00:00Z" }, end: { dateTime: "2026-12-05T21:00:00Z" } },
    { summary: "Old dinner", start: { dateTime: "2020-01-05T19:00:00Z" }, end: { dateTime: "2020-01-05T21:00:00Z" } },
  ]);

  function withDates(from: string, to: string) {
    const form = fileForm(two);
    form.set("from", from);
    form.set("to", to);
    return form;
  }

  it("brings in only what is inside the dates and says how many were left out", async () => {
    const response = await post(withDates("2026-11-30", "2026-12-16"));
    expect(location(response)).toBe(`/trips/${TRIP_ID}/inbox?imported=1&matched=0&left=1`);
    expect(await listInbox(present(world.ctx), TRIP_ID, kenny)).toHaveLength(1);
  });

  it("with no dates brings in everything", async () => {
    expect(location(await post(withDates("", "")))).toBe(`/trips/${TRIP_ID}/inbox?imported=2&matched=0&left=0`);
  });

  it.each([
    ["2026-12-16", "2026-11-30", "from_after_to"],
    ["2026-01-01", "2027-06-01", "range_too_long"],
    ["junk", "", "bad_dates"],
  ])("sends %s to %s back as %s", async (from, to, code) => {
    expect(location(await post(withDates(from, to)))).toBe(`/trips/${TRIP_ID}/import?problem=${code}`);
  });

  it("names the dates when nothing falls inside them", async () => {
    expect(location(await post(withDates("2031-01-01", "2031-01-31")))).toBe(`/trips/${TRIP_ID}/import?problem=nothing_in_dates&from=2031-01-01&to=2031-01-31`);
  });

  it("gives the count when there are too many", async () => {
    const many = toIcs(Array.from({ length: 501 }, (_, i) => ({ summary: `E${i}`, start: { dateTime: "2026-12-05T10:00:00Z" }, end: { dateTime: "2026-12-05T11:00:00Z" } })));
    const form = fileForm(many);
    expect(location(await post(form))).toBe(`/trips/${TRIP_ID}/import?problem=too_many_events&count=501`);
  });
});

describe("problem codes and their words", () => {
  it("has plain words for every code, none of them speaking as we", () => {
    for (const code of ProblemCode.options) {
      const text = problemText({ code, count: 1240, from: "2026-11-30", to: "2026-12-16" });
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/\bwe\b|\bWe\b/);
    }
  });

  it("uses the lead's sentences, with the count and the dates filled in", () => {
    expect(problemText({ code: "too_many_events", count: 1240 })).toBe("That calendar has 1,240 events in those dates. Choose dates closer to the trip.");
    expect(problemText({ code: "nothing_in_dates", from: "2026-11-30", to: "2026-12-16" })).toBe("Nothing in that calendar falls between Nov 30 and Dec 16. Change the dates or leave them empty.");
    expect(problemText({ code: "nothing_in_dates", from: "2026-11-30" })).toBe("Nothing in that calendar falls on or after Nov 30. Change the dates or leave them empty.");
    expect(problemText({ code: "from_after_to" })).toBe("The From date is after the To date.");
    expect(problemText({ code: "no_file" })).toBe("Choose a file or paste a link.");
  });

  it("does not reveal that an address was private: a refused address reads like any unreadable link", () => {
    expect(problemText({ code: problemFor(new FetchRefused("address"))?.code ?? "try_again" })).toBe(problemText({ code: problemFor(new FetchRefused("unreachable"))?.code ?? "try_again" }));
  });

  it("round trips through the address, and drops anything that is not a code, a count or a date", () => {
    const problem = { code: "nothing_in_dates" as const, from: "2026-11-30", to: "2026-12-16" };
    expect(problemFromQuery(Object.fromEntries(new URLSearchParams(problemQuery(problem))))).toEqual(problem);
    expect(problemFromQuery({ problem: "<script>" })).toBeNull();
    expect(problemFromQuery({ problem: "too_many_events", count: "x", from: "javascript:1" })).toEqual({ code: "too_many_events" });
  });

  it("maps refusals to codes without carrying their text", () => {
    expect(problemFor(new FetchRefused("address"))).toEqual({ code: "link_failed" });
    expect(problemFor(new FetchRefused("scheme"))).toEqual({ code: "link_invalid" });
    expect(problemFor(new FetchRefused("timeout"))).toEqual({ code: "link_slow" });
    expect(problemFor(new FetchRefused("size"))).toEqual({ code: "too_big" });
    expect(problemFor(new IcsProblem("not_calendar"))).toEqual({ code: "not_calendar" });
    expect(problemFor(new IcsProblem("too_big"))).toEqual({ code: "too_big" });
    expect(problemFor(new BadDates("from_after_to"))).toEqual({ code: "from_after_to" });
    expect(problemFor(new TooManyEvents(7))).toEqual({ code: "too_many_events", count: 7 });
    expect(problemFor(new NothingInDates({ from: "2026-01-01", to: null }))).toEqual({ code: "nothing_in_dates", from: "2026-01-01" });
    expect(problemFor(new Error("database exploded"))).toBeNull();
  });
});
