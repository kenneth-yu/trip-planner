import { describe, expect, it } from "vitest";
import { googleCalendarRest, GoogleApiError, GoogleAuthorizationError } from "./calendar-api";
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
