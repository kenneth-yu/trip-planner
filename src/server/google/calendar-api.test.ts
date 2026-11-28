import { describe, expect, it } from "vitest";
import { DESCRIPTION_MAX, EventLimitExceeded, googleCalendarReader, googleCalendarRest, GoogleApiError, GoogleAuthorizationError, LOCATION_MAX, MIRROR_DESCRIPTION, SUMMARY_MAX } from "./calendar-api";
import { accessTokenSource } from "./oauth";

const SECRET_BODY_TEXT = "Alice Example private booking text";

function api(status: number, body: string) {
  return googleCalendarRest(
    async () => "token",
    async () => new Response(body, { status }),
  );
}

function forbidden(reason: string) {
  return JSON.stringify({ error: { code: 403, message: SECRET_BODY_TEXT, errors: [{ reason, message: SECRET_BODY_TEXT }] } });
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof Error) return e;
  }
  throw new Error("Expected a failure");
}

describe("classifying Google failures", () => {
  it.each(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "backendError"])("treats a 403 for %s as transient", async (reason) => {
    const e = await failure(api(403, forbidden(reason)).deleteCalendar("c"));
    expect(e).toBeInstanceOf(GoogleApiError);
    expect(e).not.toBeInstanceOf(GoogleAuthorizationError);
  });

  it.each(["forbidden", "insufficientPermissions"])("treats a 403 for %s as an authorization failure", async (reason) => {
    expect(await failure(api(403, forbidden(reason)).deleteCalendar("c"))).toBeInstanceOf(GoogleAuthorizationError);
  });

  it("treats a 401 as an authorization failure", async () => {
    expect(await failure(api(401, "{}").deleteCalendar("c"))).toBeInstanceOf(GoogleAuthorizationError);
  });

  it("fails closed to transient when the 403 body is not understood", async () => {
    for (const body of ["", "<html>nope</html>", "{}", JSON.stringify({ error: { errors: [{ reason: "somethingNew" }] } })]) {
      const e = await failure(api(403, body).deleteCalendar("c"));
      expect(e).toBeInstanceOf(GoogleApiError);
      expect(e).not.toBeInstanceOf(GoogleAuthorizationError);
    }
  });

  it("keeps Google's response text out of the error", async () => {
    const cases: [number, string][] = [
      [403, forbidden("rateLimitExceeded")],
      [403, forbidden("forbidden")],
      [401, SECRET_BODY_TEXT],
      [500, SECRET_BODY_TEXT],
    ];
    for (const [status, body] of cases) {
      const e = await failure(api(status, body).deleteEvent("c", "e"));
      expect(e.message).not.toContain(SECRET_BODY_TEXT);
      expect(e.message).toContain(String(status));
    }
  });

  it("still treats a missing calendar as already deleted", async () => {
    await expect(api(404, "{}").deleteCalendar("c")).resolves.toBeUndefined();
  });
});

describe("refreshing a Google access token", () => {
  const cfg = { clientId: "id", clientSecret: "secret", redirectUri: "https://trips.test/api/google/callback" };

  it("treats invalid_grant as an authorization failure and keeps the body out of the message", async () => {
    const source = accessTokenSource(cfg, "refresh", async () => new Response(`{"error":"invalid_grant","error_description":"${SECRET_BODY_TEXT}"}`, { status: 400 }));
    const e = await failure(source());
    expect(e).toBeInstanceOf(GoogleAuthorizationError);
    expect(e.message).not.toContain(SECRET_BODY_TEXT);
    expect(e.message).not.toContain("invalid_grant");
  });

  it("treats other failures as transient", async () => {
    const source = accessTokenSource(cfg, "refresh", async () => new Response(SECRET_BODY_TEXT, { status: 503 }));
    const e = await failure(source());
    expect(e).not.toBeInstanceOf(GoogleAuthorizationError);
    expect(e.message).not.toContain(SECRET_BODY_TEXT);
  });
});

describe("reading calendars and events", () => {
  interface Call {
    url: URL;
    headers: Headers;
    method: string;
  }

  function reader(pages: Array<{ status?: number; body: unknown }>) {
    const calls: Call[] = [];
    let n = 0;
    const api = googleCalendarReader(
      async () => "ya29.read",
      async (input, init) => {
        calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers), method: init?.method ?? "GET" });
        const page = pages[Math.min(n++, pages.length - 1)];
        return new Response(JSON.stringify(page.body), { status: page.status ?? 200 });
      },
    );
    return { api, calls };
  }

  it("lists the calendars the person can read, across pages, with their own names for them, the primary one first", async () => {
    const { api, calls } = reader([
      { body: { nextPageToken: "p2", items: [{ id: "a@group.calendar.google.com", summary: "Trips" }] } },
      { body: { items: [{ id: "b@gmail.com", summary: "b@gmail.com", summaryOverride: "Kenny primary", primary: true }] } },
    ]);
    expect(await api.listCalendars()).toEqual([
      { id: "b@gmail.com", summary: "Kenny primary", primary: true },
      { id: "a@group.calendar.google.com", summary: "Trips", primary: false },
    ]);
    expect(calls.map((c) => c.url.pathname)).toEqual(["/calendar/v3/users/me/calendarList", "/calendar/v3/users/me/calendarList"]);
    expect(calls[0].url.searchParams.get("minAccessRole")).toBe("reader");
    expect(calls[1].url.searchParams.get("pageToken")).toBe("p2");
    expect(calls.every((c) => c.method === "GET" && c.headers.get("authorization") === "Bearer ya29.read")).toBe(true);
  });

  it("offers the primary calendar first and the rest alphabetically, and never the mirror calendar or Google's own calendars", async () => {
    const { api } = reader([
      {
        body: {
          items: [
            { id: "zed@group.calendar.google.com", summary: "Zed trips" },
            { id: "mirror@group.calendar.google.com", summary: "Asia, December 2026 (Trip planner)" },
            { id: "described@group.calendar.google.com", summary: "Renamed by the user", description: MIRROR_DESCRIPTION },
            { id: "en.usa#holiday@group.v.calendar.google.com", summary: "Holidays in United States" },
            { id: "addressbook#contacts@group.v.calendar.google.com", summary: "Birthdays" },
            { id: "abc@import.calendar.google.com", summary: "Subscribed feed" },
            { id: "alpha@group.calendar.google.com", summary: "alpha" },
            { id: "me@gmail.com", summary: "me@gmail.com", primary: true },
            { id: "Beta@group.calendar.google.com", summary: "Beta" },
          ],
        },
      },
    ]);
    expect((await api.listCalendars()).map((c) => c.summary)).toEqual(["me@gmail.com", "alpha", "Beta", "Zed trips"]);
  });

  it("cuts an over long summary, description and location to their caps, and keeps shorter text as it is", async () => {
    const { api } = reader([{ body: { items: [{ id: "e", summary: "s".repeat(SUMMARY_MAX + 50), description: "d".repeat(DESCRIPTION_MAX + 50), location: "l".repeat(LOCATION_MAX + 50), start: { date: "2026-12-02" }, end: { date: "2026-12-03" } }, { id: "f", summary: "Dinner", start: { date: "2026-12-02" }, end: { date: "2026-12-03" } }] } }]);
    const [long, short] = await api.listEvents("c", { timeMin: "a", timeMax: "b" });
    expect(long.summary).toHaveLength(SUMMARY_MAX);
    expect(long.description).toHaveLength(DESCRIPTION_MAX);
    expect(long.location).toHaveLength(LOCATION_MAX);
    expect(short.summary).toBe("Dinner");
  });

  it("stops reading as soon as there are more events than the limit, without asking for the next page", async () => {
    const item = (id: string) => ({ id, start: { date: "2026-12-02" }, end: { date: "2026-12-03" } });
    const { api, calls } = reader([
      { body: { nextPageToken: "n2", items: [item("1"), item("2"), item("3")] } },
      { body: { items: [item("4")] } },
    ]);
    await expect(api.listEvents("c", { timeMin: "a", timeMax: "b" }, 2)).rejects.toThrow(EventLimitExceeded);
    expect(calls).toHaveLength(1);
  });

  it("allows exactly the limit", async () => {
    const item = (id: string) => ({ id, start: { date: "2026-12-02" }, end: { date: "2026-12-03" } });
    const { api } = reader([{ body: { items: [item("1"), item("2")] } }]);
    expect(await api.listEvents("c", { timeMin: "a", timeMax: "b" }, 2)).toHaveLength(2);
  });

  it("uses the calendar's own time zone for a timed event that names none, and keeps the zone an event names", async () => {
    const { api } = reader([
      {
        body: {
          timeZone: "Asia/Tokyo",
          items: [
            { id: "bare", start: { dateTime: "2026-12-02T18:30:00+09:00" }, end: { dateTime: "2026-12-02T21:00:00+09:00" } },
            { id: "named", start: { dateTime: "2026-12-05T17:00:00+08:00", timeZone: "Asia/Hong_Kong" }, end: { dateTime: "2026-12-05T18:30:00+08:00" } },
            { id: "allday", start: { date: "2026-12-02" }, end: { date: "2026-12-03" } },
          ],
        },
      },
    ]);
    const [bare, named, allDay] = await api.listEvents("c", { timeMin: "a", timeMax: "b" });
    expect(bare.start.timeZone).toBe("Asia/Tokyo");
    expect(bare.end.timeZone).toBe("Asia/Tokyo");
    expect(named.start.timeZone).toBe("Asia/Hong_Kong");
    expect(allDay.start).toEqual({ date: "2026-12-02" });
  });

  it("turns a network failure or a timeout into a Google error the page can show, not a crash", async () => {
    const timedOut = googleCalendarReader(
      async () => "t",
      async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    );
    const error = await failure(timedOut.listCalendars());
    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error).not.toBeInstanceOf(GoogleAuthorizationError);
    expect(error instanceof GoogleApiError && error.status).toBe(503);
  });

  it("gives every read a timeout", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const watched = googleCalendarReader(
      async () => "t",
      async (_input, init) => {
        signals.push(init?.signal);
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    );
    await watched.listCalendars();
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("lists single events of a calendar for a range, encoding the calendar id", async () => {
    const { api, calls } = reader([{ body: { items: [{ id: "e1", summary: "NH159", start: { dateTime: "2026-12-01T00:55:00-05:00", timeZone: "America/New_York" }, end: { dateTime: "2026-12-01T15:25:00-05:00" } }] } }]);
    const events = await api.listEvents("shared China@group.calendar.google.com", { timeMin: "2026-11-30T00:00:00.000Z", timeMax: "2026-12-17T00:00:00.000Z" });
    expect(events).toEqual([{ id: "e1", summary: "NH159", start: { dateTime: "2026-12-01T00:55:00-05:00", timeZone: "America/New_York" }, end: { dateTime: "2026-12-01T15:25:00-05:00" } }]);
    expect(calls[0].url.pathname).toBe("/calendar/v3/calendars/shared%20China%40group.calendar.google.com/events");
    expect(calls[0].url.searchParams.get("singleEvents")).toBe("true");
    expect(calls[0].url.searchParams.get("timeMin")).toBe("2026-11-30T00:00:00.000Z");
    expect(calls[0].url.searchParams.get("timeMax")).toBe("2026-12-17T00:00:00.000Z");
  });

  it("drops cancelled events and keeps nothing it was not asked to read, such as attendees and organizers", async () => {
    const { api } = reader([
      {
        body: {
          items: [
            { id: "gone", status: "cancelled", start: { date: "2026-12-02" }, end: { date: "2026-12-03" } },
            { id: "kept", status: "confirmed", summary: "Dinner", attendees: [{ email: "friend@example.test" }], organizer: { email: "kenny@example.test" }, creator: { email: "kenny@example.test" }, conferenceData: { x: 1 }, start: { date: "2026-12-02" }, end: { date: "2026-12-03" } },
          ],
        },
      },
    ]);
    const events = await api.listEvents("c", { timeMin: "2026-12-01T00:00:00Z", timeMax: "2026-12-05T00:00:00Z" });
    expect(events.map((e) => e.id)).toEqual(["kept"]);
    expect(JSON.stringify(events)).not.toMatch(/friend@example|attendees|organizer|creator|conferenceData/);
  });

  it("follows event pages", async () => {
    const { api, calls } = reader([
      { body: { nextPageToken: "n2", items: [{ id: "1", start: { date: "2026-12-02" }, end: { date: "2026-12-03" } }] } },
      { body: { items: [{ id: "2", start: { date: "2026-12-03" }, end: { date: "2026-12-04" } }] } },
    ]);
    expect((await api.listEvents("c", { timeMin: "a", timeMax: "b" })).map((e) => e.id)).toEqual(["1", "2"]);
    expect(calls[1].url.searchParams.get("pageToken")).toBe("n2");
  });

  it("stops on a listing that never ends instead of looping", async () => {
    const { api, calls } = reader([{ body: { nextPageToken: "again", items: [] } }]);
    await expect(api.listEvents("c", { timeMin: "a", timeMax: "b" })).rejects.toThrow(GoogleApiError);
    expect(calls).toHaveLength(20);
  });

  it("treats a refused token as an authorization failure and an unknown event shape as a failure, keeping Google's text out", async () => {
    const refused = reader([{ status: 401, body: { error: { message: SECRET_BODY_TEXT } } }]);
    const error = await failure(refused.api.listCalendars());
    expect(error).toBeInstanceOf(GoogleAuthorizationError);
    expect(error.message).not.toContain(SECRET_BODY_TEXT);
    const insufficient = reader([{ status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } }]);
    expect(await failure(insufficient.api.listEvents("c", { timeMin: "a", timeMax: "b" }))).toBeInstanceOf(GoogleAuthorizationError);
    const odd = reader([{ body: { items: [{ id: 3 }] } }]);
    await expect(odd.api.listEvents("c", { timeMin: "a", timeMax: "b" })).rejects.toThrow();
  });
});
