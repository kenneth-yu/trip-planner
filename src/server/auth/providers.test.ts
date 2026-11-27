import { describe, expect, it } from "vitest";
import { enabledProviders } from "./providers";

const google = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };
const apple = { AUTH_APPLE_ID: "id", AUTH_APPLE_SECRET: "secret" };
const email = { EMAIL_API_KEY: "key", EMAIL_FROM: "Trips <trips@example.com>" };

describe("enabledProviders", () => {
  it("is empty with no configuration", () => {
    expect(enabledProviders({ NODE_ENV: "production" })).toEqual([]);
  });

  it("enables Google only when both of its variables exist", () => {
    expect(enabledProviders(google)).toEqual(["google"]);
    expect(enabledProviders({ GOOGLE_CLIENT_ID: "id" })).toEqual([]);
    expect(enabledProviders({ GOOGLE_CLIENT_SECRET: "secret" })).toEqual([]);
  });

  it("leaves Apple out without both of its variables", () => {
    expect(enabledProviders({ ...google, AUTH_APPLE_ID: "id" })).toEqual(["google"]);
    expect(enabledProviders({ ...google, AUTH_APPLE_SECRET: "secret" })).toEqual(["google"]);
    expect(enabledProviders({ ...google, ...apple })).toEqual(["google", "apple"]);
  });

  it("leaves the email link out without an email API key and sender, outside local development", () => {
    expect(enabledProviders({ ...google, EMAIL_API_KEY: "key", NODE_ENV: "production" })).toEqual(["google"]);
    expect(enabledProviders({ ...google, EMAIL_FROM: "a@example.com", NODE_ENV: "production" })).toEqual(["google"]);
    expect(enabledProviders({ ...google, ...email, NODE_ENV: "production" })).toEqual(["google", "email"]);
  });

  it("offers the email link in local development through the dev outbox, never in production", () => {
    expect(enabledProviders({ DEV_SIGN_IN: "1", NODE_ENV: "development" })).toEqual(["email"]);
    expect(enabledProviders({ DEV_SIGN_IN: "1", NODE_ENV: "production" })).toEqual([]);
    expect(enabledProviders({ NODE_ENV: "development" })).toEqual([]);
  });

  it("keeps Google first", () => {
    expect(enabledProviders({ ...email, ...apple, ...google })).toEqual(["google", "apple", "email"]);
  });
});
