import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, TRIP_ID, USERS } from "@/fixtures/december-trip";
import { present } from "@/testing/present";
import { toIcs } from "@/testing/ics-fixture";
import { testContext } from "@/server/testing";
import { listInbox } from "@/server/services/inbox-service";
import type { ServiceContext } from "@/server/services/context";
import { kenny } from "@/server/testing";
import { POST } from "./route";
import { PROBLEM_TEXT, ProblemCode, problemFor } from "./problems";
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
    expect(location(response)).toMatch(new RegExp(`^/trips/${TRIP_ID}/import\\?done=\\d+&skipped=0&repeating=0$`));
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
    expect(location(response)).toBe(`/trips/${TRIP_ID}/import?problem=link_off`);
    expect(location(response)).not.toContain("SECRETTOKEN");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("problem codes", () => {
  it("has copy for every code", () => {
    for (const code of ProblemCode.options) expect(PROBLEM_TEXT[code].length).toBeGreaterThan(10);
  });

  it("maps refusals to codes without carrying their text", () => {
    expect(problemFor(new FetchRefused("address"))).toBe("link_failed");
    expect(problemFor(new FetchRefused("scheme"))).toBe("link_invalid");
    expect(problemFor(new FetchRefused("timeout"))).toBe("link_slow");
    expect(problemFor(new FetchRefused("size"))).toBe("too_big");
    expect(problemFor(new IcsProblem("not_calendar"))).toBe("not_calendar");
    expect(problemFor(new IcsProblem("too_big"))).toBe("too_big");
    expect(problemFor(new Error("database exploded"))).toBeNull();
  });
});
