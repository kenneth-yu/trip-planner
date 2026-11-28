import { describe, expect, it } from "vitest";
import { googleCalendarReader, googleCalendarRest, GoogleApiError, GoogleAuthorizationError } from "./calendar-api";
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

  it("lists the calendars the person can read, across pages, with their own names for them", async () => {
    const { api, calls } = reader([
      { body: { nextPageToken: "p2", items: [{ id: "a@group.calendar.google.com", summary: "Trips" }] } },
      { body: { items: [{ id: "b@gmail.com", summary: "b@gmail.com", summaryOverride: "Kenny primary" }] } },
    ]);
    expect(await api.listCalendars()).toEqual([
      { id: "a@group.calendar.google.com", summary: "Trips" },
      { id: "b@gmail.com", summary: "Kenny primary" },
    ]);
    expect(calls.map((c) => c.url.pathname)).toEqual(["/calendar/v3/users/me/calendarList", "/calendar/v3/users/me/calendarList"]);
    expect(calls[0].url.searchParams.get("minAccessRole")).toBe("reader");
    expect(calls[1].url.searchParams.get("pageToken")).toBe("p2");
    expect(calls.every((c) => c.method === "GET" && c.headers.get("authorization") === "Bearer ya29.read")).toBe(true);
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
