import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { concreteRoute, concreteRoutes, routeOfPage, routesTouched } from "../../tools/ci/changed-routes-lib.mjs";

const TRIP = "00000000-0000-4000-8300-000000000001";
const pages = [
  "src/app/page.tsx",
  "src/app/sign-in/page.tsx",
  "src/app/trips/[tripId]/page.tsx",
  "src/app/trips/[tripId]/add/page.tsx",
  "src/app/trips/[tripId]/inbox/page.tsx",
  "src/app/trips/[tripId]/items/[itemId]/page.tsx",
  "src/app/invite/problem/[kind]/page.tsx",
  "src/app/trips/new/page.tsx",
];

describe("routes of changed pages", () => {
  it("turns a page file into its route, with fixture ids for the parameters it knows", () => {
    expect(routeOfPage("src/app/page.tsx")).toBe("/");
    expect(routeOfPage("src/app/trips/[tripId]/add/page.tsx")).toBe("/trips/[tripId]/add");
    expect(concreteRoute("/trips/[tripId]/add")).toBe(`/trips/${TRIP}/add`);
    expect(concreteRoute("/invite/problem/[kind]")).toBeNull();
  });

  it("maps a changed file to the pages at or below its folder", () => {
    expect(routesTouched(["src/app/trips/[tripId]/inbox/entry-form.tsx"], pages)).toEqual(["src/app/trips/[tripId]/inbox/page.tsx"]);
    expect(routesTouched(["src/app/trips/[tripId]/day-view.tsx"], pages).sort()).toEqual([
      "src/app/trips/[tripId]/add/page.tsx",
      "src/app/trips/[tripId]/inbox/page.tsx",
      "src/app/trips/[tripId]/items/[itemId]/page.tsx",
      "src/app/trips/[tripId]/page.tsx",
    ]);
  });

  it("maps a file at the top of the app folder to every page", () => {
    expect(routesTouched(["src/app/layout.tsx"], pages)).toHaveLength(pages.length);
    expect(routesTouched(["src/app/globals.css"], pages)).toHaveLength(pages.length);
  });

  it("maps nothing for files outside the pages, such as api routes, services and tests of other folders", () => {
    expect(routesTouched(["src/app/api/mcp/route.ts", "src/server/a.ts", "e2e/a.spec.ts", "docs/UX.md"], pages)).toEqual([]);
  });

  it("lists only routes that can be opened, sorted and without duplicates", () => {
    expect(concreteRoutes(pages)).toEqual(
      [`/`, `/sign-in`, `/trips/new`, `/trips/${TRIP}`, `/trips/${TRIP}/add`, `/trips/${TRIP}/inbox`, `/trips/${TRIP}/items/00000000-0000-4000-8400-000000000005`].sort(),
    );
  });
});

describe("the command line step", () => {
  const tool = path.join(process.cwd(), "tools", "ci", "changed-routes.mjs");
  const run = (input: string, args: string[] = [], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [tool, ...args], { input, env: { NODE_ENV: "development", PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" }).stdout.trim();

  it("names the touched routes of the real app", () => {
    expect(run("src/app/sign-in/form.tsx\n", [], { CHANGED_TOTAL: "1" })).toBe("/sign-in");
    expect(run("docs/UX.md\n", [], { CHANGED_TOTAL: "1" })).toBe("");
  });

  it("falls back to every route when the file list is missing, empty or capped", () => {
    const everything = run("", ["--all"]);
    expect(everything.split(",").length).toBeGreaterThan(5);
    expect(run("", [], { CHANGED_TOTAL: "" })).toBe(everything);
    expect(run("src/app/sign-in/form.tsx\n", [], { CHANGED_TOTAL: "3000" })).toBe(everything);
    expect(run("src/app/sign-in/form.tsx\n", [], {})).toBe(everything);
  });
});
