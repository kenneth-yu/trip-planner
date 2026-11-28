import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import plugin from "../../tools/lint/copy.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

const options = [{ properNouns: ["Google Calendar", "Google", "Hong Kong", "New York"] }];
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
    tsx(`const a = <h2>Hong Kong</h2>;`),
    tsx(`const a = <h2>{place ? place.city : "New York"}</h2>;`),
    tsx(`const a = <p>{ok ? "Saved" : "Try again in a minute."}</p>;`),
    tsx('const a = <p>{`Landing in ${city} at noon`}</p>;'),
    tsx(`const a = <p>{status === "Done!" ? "Done" : "Pending"}</p>;`),
    tsx('const a = <input aria-label={`Name for ${person}`} />;'),
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
    { ...tsx(`const a = <p>{ok ? "Saved \u2705" : "Try again"}</p>;`), errors: [{ messageId: "emoji" }] },
    { ...tsx(`const a = <p>{failed && "Please try again"}</p>;`), errors: [{ messageId: "filler" }] },
    { ...tsx('const a = <p>{`Hello ${name}!`}</p>;'), errors: [{ messageId: "exclamation" }] },
    { ...tsx(`const a = <button>{ok ? "Add Flight" : "Add stay"}</button>;`), errors: [{ messageId: "titleCase" }] },
    { ...tsx('const a = <input aria-label={`Simply ${x}`} />;'), errors: [{ messageId: "filler" }] },
    { ...tsx(`const a = <p>Welcome!</p>;`), errors: [{ messageId: "exclamation" }] },
    { ...tsx(`const a = <button>Add Flight</button>;`), errors: [{ messageId: "titleCase" }] },
    { ...tsx(`const a = <h2>{"Your Trips"}</h2>;`), errors: [{ messageId: "titleCase" }] },
    { ...tsx(`const a = <h1>SAVE TRIP</h1>;`), errors: [{ messageId: "shouting" }] },
  ],
});
