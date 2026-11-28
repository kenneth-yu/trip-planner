import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export const DEMO_TRIPS = [
  { name: "December trip", id: "00000000-0000-4000-8300-000000000001" },
  { name: "Lisbon, someday", id: "00000000-0000-4000-8300-000000000101" },
  { name: "Chicago weekend", id: "00000000-0000-4000-8300-000000000102" },
  { name: "Tokyo and Kyoto with friends", id: "00000000-0000-4000-8300-000000000103" },
] as const;

export interface PageUnderTest {
  label: string;
  path: string;
  route: string;
  signedIn: boolean;
  status?: number;
}

const TRIP_PAGES: { suffix: string; route: string }[] = [
  { suffix: "", route: "/trips/[tripId]" },
  { suffix: "?day=all", route: "/trips/[tripId]" },
  { suffix: "/add", route: "/trips/[tripId]/add" },
  { suffix: "/deadlines", route: "/trips/[tripId]/deadlines" },
  { suffix: "/inbox", route: "/trips/[tripId]/inbox" },
  { suffix: "/connect", route: "/trips/[tripId]/connect" },
  { suffix: "/share", route: "/trips/[tripId]/share" },
  { suffix: "/activity", route: "/trips/[tripId]/activity" },
  { suffix: "/ideas", route: "/trips/[tripId]/ideas" },
  { suffix: "/import", route: "/trips/[tripId]/import" },
  { suffix: "/import/google", route: "/trips/[tripId]/import/google" },
  { suffix: "/settings", route: "/trips/[tripId]/settings" },
  { suffix: "/settings/delete", route: "/trips/[tripId]/settings/delete" },
];

const DECEMBER_FLIGHT = "00000000-0000-4000-8400-000000000001";
const DECEMBER_STAY = "00000000-0000-4000-8400-000000000002";
const DECEMBER = DEMO_TRIPS[0].id;

export const PAGES: PageUnderTest[] = [
  { label: "sign in", path: "/sign-in", route: "/sign-in", signedIn: false },
  { label: "trip list", path: "/", route: "/", signedIn: true },
  { label: "new trip", path: "/trips/new", route: "/trips/new", signedIn: true },
  { label: "trip not on your account", path: "/not-on-your-account", route: "/not-on-your-account", signedIn: true },
  { label: "account", path: "/account", route: "/account", signedIn: true },
  { label: "page not found", path: "/no-such-page", route: "/not-found", signedIn: true, status: 404 },
  { label: "view link that does not work", path: "/v/not-a-working-link", route: "/v/[token]", signedIn: false, status: 404 },
  { label: "invite lost", path: "/invite/lost", route: "/invite/lost", signedIn: false },
  { label: "invite join without a cookie", path: "/invite/join", route: "/invite/join", signedIn: false },
  { label: "invite expired", path: "/invite/problem/expired", route: "/invite/problem/[kind]", signedIn: false },
  { label: "invite unusable", path: "/invite/problem/unusable", route: "/invite/problem/[kind]", signedIn: false },
  { label: "December flight details", path: `/trips/${DECEMBER}/items/${DECEMBER_FLIGHT}`, route: "/trips/[tripId]/items/[itemId]", signedIn: true },
  { label: "December stay details", path: `/trips/${DECEMBER}/items/${DECEMBER_STAY}`, route: "/trips/[tripId]/items/[itemId]", signedIn: true },
  { label: "December flight edit", path: `/trips/${DECEMBER}/items/${DECEMBER_FLIGHT}/edit`, route: "/trips/[tripId]/items/[itemId]/edit", signedIn: true },
  ...DEMO_TRIPS.flatMap((trip) => TRIP_PAGES.map((p) => ({ label: `${trip.name}${p.suffix === "" ? "" : ` ${p.suffix}`}`, path: `/trips/${trip.id}${p.suffix}`, route: p.route, signedIn: true }))),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function pageRoutesInApp(): string[] {
  const appDir = path.join(import.meta.dirname, "..", "src", "app");
  return walk(appDir)
    .filter((f) => path.basename(f) === "page.tsx")
    .map((f) => {
      const dir = path.relative(appDir, path.dirname(f)).split(path.sep).join("/");
      return dir === "" ? "/" : `/${dir}`;
    })
    .sort();
}
