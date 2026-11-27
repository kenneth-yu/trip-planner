import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { firstLoadFiles, markdownTable, parseBuildManifest, parseClientReferenceManifest, routeFromEntry, violations, type RouteSize } from "./bundle-budget";

const client = parseClientReferenceManifest(readFileSync("perf/fixtures/trip-page_client-reference-manifest.js", "utf8"));
const build = parseBuildManifest(readFileSync("perf/fixtures/trip-page-build-manifest.json", "utf8"));

describe("bundle manifest parser on a recorded trip page build", () => {
  it("reads the route entry and the page's client scripts, without stylesheets", () => {
    expect(client.entry).toBe("/trips/[tripId]/page");
    expect(client.jsFiles).toEqual(["static/chunks/3qfy96eoyh-ek.js", "static/chunks/2tst66luc94bn.js", "static/chunks/2qnlivaomj6ae.js"]);
  });

  it("first load is the shared main files plus the page's own, each once, without the polyfill", () => {
    const files = firstLoadFiles(build, client);
    expect(files).toHaveLength(9);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain("static/chunks/39_j1bdzreq0m.js");
    expect(files).toContain("static/chunks/2qnlivaomj6ae.js");
    expect(files).not.toContain("static/chunks/0cz1d0mv5g_q7.js");
  });

  it("names the route without the page suffix", () => {
    expect(routeFromEntry("/trips/[tripId]/page")).toBe("/trips/[tripId]");
    expect(routeFromEntry("/page")).toBe("/");
  });

  it("rejects a file that is not a client reference manifest", () => {
    expect(() => parseClientReferenceManifest("module.exports = {}")).toThrow("not a client reference manifest");
  });
});

describe("budget verdicts", () => {
  const size = (route: string, gzipBytes: number, budgetGzipBytes: number | null): RouteSize => ({ route, files: 3, gzipBytes, budgetGzipBytes });

  it("passes a route at or under its budget", () => {
    expect(violations([size("/", 100, 100), size("/a", 50, 100)], ["/", "/a"])).toEqual([]);
  });

  it("fails a route over its budget and says by how much it loads", () => {
    expect(violations([size("/", 101, 100)], ["/"])).toEqual(["/ loads 101 bytes of gzipped JavaScript, over its 100 byte budget."]);
  });

  it("fails a route with no budget and a budget with no route", () => {
    expect(violations([size("/new", 10, null)], ["/gone"])).toEqual([
      "/new has no budget. Add it to bundle in perf/budgets.json with a measured size.",
      "perf/budgets.json budgets /gone, which is not a route in this build. Remove it or rename it.",
    ]);
  });

  it("renders a markdown table row per route", () => {
    expect(markdownTable([size("/", 2048, 4096)])).toContain("| / | 3 | 2.0 kB | 4.0 kB |");
  });
});
