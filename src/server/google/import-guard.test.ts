import { describe, expect, it } from "vitest";
import { fakeGoogleActive, IMPORT_CALLBACK_PATH, importIsRateLimited, importOAuthConfig } from "./import-guard";

const e2e = { GOOGLE_IMPORT_FAKE: "1", DEV_SIGN_IN: "1" };

describe("the fake Google for the end to end tests", () => {
  it("is on only with the flag, dev sign in, no production deployment and no real Google configuration", () => {
    expect(fakeGoogleActive(e2e)).toBe(true);
    expect(fakeGoogleActive({ ...e2e, VERCEL_ENV: "preview" })).toBe(true);
    expect(fakeGoogleActive({})).toBe(false);
    expect(fakeGoogleActive({ GOOGLE_IMPORT_FAKE: "1" })).toBe(false);
    expect(fakeGoogleActive({ DEV_SIGN_IN: "1" })).toBe(false);
    expect(fakeGoogleActive({ ...e2e, GOOGLE_IMPORT_FAKE: "true" })).toBe(false);
    expect(fakeGoogleActive({ ...e2e, VERCEL_ENV: "production" })).toBe(false);
    expect(fakeGoogleActive({ ...e2e, GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" })).toBe(false);
  });

  it("agrees with the app that one of the two Google settings alone is not a configuration", () => {
    expect(fakeGoogleActive({ ...e2e, GOOGLE_CLIENT_ID: "client" })).toBe(true);
    expect(fakeGoogleActive({ ...e2e, GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" })).toBe(false);
  });
});

describe("the import guard in this process", () => {
  it("opens nothing without a rate rule when the fake is off", () => {
    expect(importIsRateLimited("GET", "/trips/x/import/google")).toBe(false);
    expect(importOAuthConfig("https://trips.test")).toBeNull();
    expect(IMPORT_CALLBACK_PATH).toBe("/api/google/import/callback");
  });
});
