import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import plugin from "../../tools/lint/copy.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

const options = [{ properNouns: ["Google Calendar", "Google"] }];
const tsx = (code: string) => ({ code, filename: "x.tsx", options });

tester.run("copy", plugin.rules.copy, {
  valid: [
    tsx(`const a = <h1>Add flight</h1>;`),
    tsx(`const a = <button>Sign in with Google</button>;`),
    tsx(`const a = <button>Connect Google Calendar</button>;`),
    tsx(`const a = <h2>Trip name</h2>;`),
    tsx(`const a = <p>Hotel Resol Ueno becomes non refundable in 2 days.</p>;`),
    tsx(`const a = <p>Tokyo Haneda</p>;`),
    tsx(`const a = <input placeholder="Japan and Hong Kong" aria-label="Trip name" />;`),
    tsx(`const a = <button>{"Copy link"}</button>;`),
    tsx(`const a = <h1>{trip.name}</h1>;`),
    tsx(`const a = <p>Check in at noon, check out by midnight, 12:30pm lunch.</p>;`),
  ],
  invalid: [
    { ...tsx(`const a = <p>Landed {"✈️"} early</p>;`), errors: [{ messageId: "emoji" }] },
    { ...tsx(`const a = <p>Saved ✅</p>;`), errors: [{ messageId: "emoji" }] },
    { ...tsx(`const a = <p>Please wait</p>;`), errors: [{ messageId: "filler" }] },
    { ...tsx(`const a = <p>Trip saved successfully.</p>;`), errors: [{ messageId: "filler" }] },
    { ...tsx(`const a = <input placeholder="Simply type a city" />;`), errors: [{ messageId: "filler" }] },
    { ...tsx(`const a = <p>Lunch at 12:00pm</p>;`), errors: [{ messageId: "unclear" }] },
    { ...tsx(`const a = <p>Seat: N/A</p>;`), errors: [{ messageId: "unclear" }] },
    { ...tsx(`const a = <p>Welcome!</p>;`), errors: [{ messageId: "exclamation" }] },
    { ...tsx(`const a = <button>Add Flight</button>;`), errors: [{ messageId: "titleCase" }] },
    { ...tsx(`const a = <h2>{"Your Trips"}</h2>;`), errors: [{ messageId: "titleCase" }] },
    { ...tsx(`const a = <h1>SAVE TRIP</h1>;`), errors: [{ messageId: "shouting" }] },
  ],
});
