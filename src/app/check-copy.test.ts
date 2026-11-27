import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe("one name for checks", () => {
  const files = sources(import.meta.dirname);

  it.each(["Worth double-checking", "Coming up", "Decisions ahead"])("%s appears nowhere in the app", (phrase) => {
    expect(files.filter((f) => readFileSync(f, "utf8").includes(phrase))).toEqual([]);
  });

  it("the Deadlines page is titled Deadlines and checks", () => {
    expect(readFileSync(path.join(import.meta.dirname, "trips/[tripId]/deadlines/page.tsx"), "utf8")).toContain("Deadlines and checks");
  });

  it("the phone alert is neutral unless it is a deadline", () => {
    const css = readFileSync(path.join(import.meta.dirname, "trips/[tripId]/phone.module.css"), "utf8");
    const base = /\n\.alert \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(base).not.toContain("--warning");
    expect(readFileSync(path.join(import.meta.dirname, "trips/[tripId]/up-next.tsx"), "utf8")).toContain('const warn = alert.kind === "deadline"');
  });
});
