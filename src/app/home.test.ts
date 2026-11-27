import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { signInModel } from "./sign-in/model";
import { SignInScreen } from "./sign-in/sign-in-screen";
import { TripList } from "./sign-in/trip-list";
import { NotOnYourAccount } from "./not-on-your-account/not-on-your-account";

vi.mock("./sign-in/actions", () => ({ continueWithProvider: vi.fn(), sendEmailLink: vi.fn() }));

const google = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };

function render(env: Record<string, string>, params: { next?: string; error?: string } = {}) {
  return renderToStaticMarkup(createElement(SignInScreen, signInModel(env, params)));
}

describe("sign in screen", () => {
  it("under production environment shows no demo accounts and no Continue as", () => {
    const html = render({ NODE_ENV: "production", ...google });
    expect(html).not.toContain("Continue as");
    expect(html).not.toContain("Demo accounts");
    expect(html).toContain("Continue with Google");
  });

  it("under production environment with DEV_SIGN_IN set refuses to render at all", () => {
    expect(() => render({ NODE_ENV: "production", DEV_SIGN_IN: "1", ...google })).toThrow(/DEV_SIGN_IN/);
    expect(() => render({ NODE_ENV: "production", VERCEL_ENV: "production", DEV_SIGN_IN: "1" })).toThrow(/DEV_SIGN_IN/);
  });

  it("in development lists demo accounts under a plain label, after the real options", () => {
    const html = render({ NODE_ENV: "development", DEV_SIGN_IN: "1", ...google });
    expect(html).toContain("Demo accounts, for testing only");
    expect(html).toContain("Continue as Kenneth Yu");
    expect(html.indexOf("Continue with Google")).toBeLessThan(html.indexOf("Demo accounts"));
    expect(html.indexOf("Email me a link")).toBeLessThan(html.indexOf("Demo accounts"));
  });

  it("on a Vercel preview lists demo accounts", () => {
    const html = render({ NODE_ENV: "production", VERCEL_ENV: "preview", DEV_SIGN_IN: "1", ...google });
    expect(html).toContain("Demo accounts");
  });

  it("carries the deep link into the demo sign in", () => {
    const html = render({ NODE_ENV: "development", DEV_SIGN_IN: "1" }, { next: "/trips/x?day=2026-12-05" });
    expect(html).toContain("next=%2Ftrips%2Fx%3Fday%3D2026-12-05");
  });

  it("shows no Apple button without its variables and no email form without email configuration", () => {
    const html = render({ NODE_ENV: "production", ...google });
    expect(html).not.toContain("Apple");
    expect(html).not.toContain("Email me a link");
    expect(html).not.toContain(">or<");
  });

  it("shows Apple and the email form when configured, Google first and primary, then the word or", () => {
    const html = render({ NODE_ENV: "production", ...google, AUTH_APPLE_ID: "i", AUTH_APPLE_SECRET: "s", EMAIL_API_KEY: "k", EMAIL_FROM: "a@example.com" });
    expect(html.indexOf("Continue with Google")).toBeLessThan(html.indexOf("Continue with Apple"));
    expect(html.indexOf("Continue with Apple")).toBeLessThan(html.indexOf(">or<"));
    expect(html.indexOf(">or<")).toBeLessThan(html.indexOf("Email me a link"));
    expect(html).toContain("<label");
    expect(html).toContain("Email</label>");
  });

  it("uses the exact copy: title Sign in, no tagline, no logo, no extras", () => {
    const html = render({ NODE_ENV: "production", ...google });
    expect(html).toContain("<h1");
    expect(html).toContain(">Sign in</h1>");
    expect(html).not.toMatch(/remember me|password|terms|privacy|welcome/i);
    expect(html).not.toContain("Use the account your trip invite was sent to.");
  });

  it("says why to sign in when arriving from a shared trip link", () => {
    expect(render({ NODE_ENV: "production", ...google }, { next: "/trips/x?day=2026-12-05" })).toContain("Sign in to see this trip.");
    expect(render({ NODE_ENV: "production", ...google }, { next: "/invite/accept" })).not.toContain("Sign in to see this trip.");
    expect(render({ NODE_ENV: "production", ...google })).not.toContain("Sign in to see this trip.");
  });

  it("explains the account to use only when arriving from an invite", () => {
    expect(render({ NODE_ENV: "production", ...google }, { next: "/invite/accept" })).toContain("Use the account your trip invite was sent to.");
    expect(render({ NODE_ENV: "production", ...google }, { next: "/trips/x" })).not.toContain("trip invite");
  });

  it("says an expired link has expired and a failure without naming anything", () => {
    const env = { NODE_ENV: "production", EMAIL_API_KEY: "k", EMAIL_FROM: "a@example.com", ...google };
    const expired = render(env, { error: "Verification" });
    expect(expired).toContain("That link has expired or was already used. Request a new one.");
    expect(expired).toContain("Email me a link");
    const failed = render(env, { error: "OAuthAccountNotLinked" });
    expect(failed).toContain("We could not sign you in. Try again.");
    expect(failed).not.toContain("email already");
  });

  it("tells someone over the sign in limit to wait", () => {
    const env = { NODE_ENV: "production", EMAIL_API_KEY: "k", EMAIL_FROM: "a@example.com", ...google };
    expect(render(env, { error: "TooMany" })).toContain("Too many sign in attempts. Wait a few minutes and try again.");
  });

  it("drops an unsafe next so it never reaches the form", () => {
    const html = render({ NODE_ENV: "production", ...google }, { next: "https://evil.example" });
    expect(html).not.toContain("evil.example");
  });
});

describe("trip that is not on the account", () => {
  it("explains, and offers Sign out and Your trips", () => {
    const html = renderToStaticMarkup(createElement(NotOnYourAccount, { signOut: vi.fn() }));
    expect(html).toContain("This trip is not on your account.");
    expect(html).toContain("Sign in with the email your travel partner uses, or ask them to invite you.");
    expect(html).toContain("Sign out");
    expect(html).toContain('href="/"');
    expect(html).toContain("Your trips");
  });
});

describe("home page content for a signed in person", () => {
  const signOut = vi.fn();

  it("shows No trips yet with one New trip link to /trips/new", () => {
    const html = renderToStaticMarkup(createElement(TripList, { trips: [], signOut }));
    expect(html).toContain("No trips yet");
    expect(html).toContain('href="/trips/new"');
    expect(html).toContain(">New trip<");
  });

  it("lists trips and always ends with a Sign out button", () => {
    const html = renderToStaticMarkup(createElement(TripList, { trips: [{ id: "t1", name: "Japan and Hong Kong" }], signOut }));
    expect(html).toContain("Japan and Hong Kong");
    expect(html).toContain('href="/trips/t1"');
    expect(html.indexOf("Japan and Hong Kong")).toBeLessThan(html.indexOf("Sign out"));
    expect(html).not.toContain("Continue as");
  });

  it("offers New trip under a list of trips too", () => {
    const html = renderToStaticMarkup(createElement(TripList, { trips: [{ id: "t1", name: "Japan and Hong Kong" }], signOut }));
    expect(html).toContain('href="/trips/new"');
    expect(html.indexOf("Japan and Hong Kong")).toBeLessThan(html.indexOf(">New trip<"));
  });
});
