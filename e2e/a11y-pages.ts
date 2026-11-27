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
}

const TRIP_PAGES: { suffix: string; route: string }[] = [
  { suffix: "", route: "/trips/[tripId]" },
  { suffix: "?day=all", route: "/trips/[tripId]" },
  { suffix: "/add", route: "/trips/[tripId]/add" },
  { suffix: "/deadlines", route: "/trips/[tripId]/deadlines" },
  { suffix: "/inbox", route: "/trips/[tripId]/inbox" },
  { suffix: "/connect", route: "/trips/[tripId]/connect" },
];

export const PAGES: PageUnderTest[] = [
  { label: "sign in", path: "/sign-in", route: "/sign-in", signedIn: false },
  { label: "trip list", path: "/", route: "/", signedIn: true },
  { label: "new trip", path: "/trips/new", route: "/trips/new", signedIn: true },
  { label: "trip not on your account", path: "/not-on-your-account", route: "/not-on-your-account", signedIn: true },
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
