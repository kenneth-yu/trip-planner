import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codeChanged, isDocsPath, LISTING_CAP, perfNeeded } from "../../tools/ci/changed-paths-lib.mjs";

describe("docs only paths", () => {
  it.each(["README.md", "CLAUDE.md", "docs/UX.md", "docs/deep/notes.md", ".pipeline/status.md", ".pipeline/scratch/a.json"])("%s is documentation", (file) => {
    expect(isDocsPath(file)).toBe(true);
  });

  it.each(["docs/STATECHARTS.md", "src/server/notes.md", "e2e/readme.md", "src/server/a.ts", "docs/diagram.png", "tools/x.mjs", "public/readme.md"])("%s is code", (file) => {
    expect(isDocsPath(file)).toBe(false);
  });
});

describe("whether code changed", () => {
  it("is false only when every listed file is documentation", () => {
    expect(codeChanged({ files: ["docs/UX.md", "README.md"], total: 2 })).toBe(false);
    expect(codeChanged({ files: ["docs/UX.md", "src/a.ts"], total: 2 })).toBe(true);
  });

  it("fails closed when the listing is missing, empty or its size is unknown", () => {
    expect(codeChanged({ files: [], total: 0 })).toBe(true);
    expect(codeChanged({ files: undefined, total: 3 })).toBe(true);
    expect(codeChanged({ files: ["docs/UX.md"], total: Number.NaN })).toBe(true);
    expect(codeChanged({ files: ["docs/UX.md"], total: undefined })).toBe(true);
  });

  it("counts a listing at the API's file cap as code", () => {
    expect(codeChanged({ files: ["docs/UX.md"], total: LISTING_CAP })).toBe(true);
    expect(codeChanged({ files: ["docs/UX.md"], total: LISTING_CAP - 1 })).toBe(false);
  });

  it("counts a code file renamed to Markdown or into the pipeline notes as code, because the old name is listed", () => {
    expect(codeChanged({ files: ["docs/old.md", "src/server/old.ts"], total: 1 })).toBe(true);
    expect(codeChanged({ files: [".pipeline/moved.md", "src/server/old.ts"], total: 1 })).toBe(true);
  });
});

describe("whether performance needs measuring", () => {
  it.each(["src/app/page.tsx", "src/server/db/client.ts", "src/components/x.tsx", "src/lib/a.ts", "src/domain/a.ts", "src/proxy.ts", "src/instrumentation.ts", "drizzle/0001.sql", "perf/serve.ts", "next.config.ts", "package.json", "package-lock.json", "lighthouserc.json", "vitest.perf.config.mts", "scripts/bundle-budget.ts", ".github/workflows/perf.yml"])("%s needs it", (file) => {
    expect(perfNeeded({ files: [file], total: 1, labels: [] })).toBe(true);
  });

  it.each(["docs/UX.md", "e2e/a.spec.ts", "tools/x.mjs", "tsconfig.json", ".github/workflows/ci.yml"])("%s does not", (file) => {
    expect(perfNeeded({ files: [file], total: 1, labels: [] })).toBe(false);
  });

  it("is needed with the exact perf label and not with a look-alike", () => {
    expect(perfNeeded({ files: ["docs/UX.md"], total: 1, labels: ["perf"] })).toBe(true);
    expect(perfNeeded({ files: ["docs/UX.md"], total: 1, labels: ["x,perf", "performance", "Perf"] })).toBe(false);
  });

  it("fails closed when the listing is missing or capped", () => {
    expect(perfNeeded({ files: [], total: 0, labels: [] })).toBe(true);
    expect(perfNeeded({ files: ["docs/UX.md"], total: LISTING_CAP, labels: [] })).toBe(true);
    expect(perfNeeded({ files: ["docs/UX.md"], total: undefined, labels: [] })).toBe(true);
  });
});

describe("the command line step", () => {
  const tool = path.join(process.cwd(), "tools", "ci", "changed-paths.mjs");
  const run = (mode: string, input: string, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [tool, mode], { input, env: { NODE_ENV: "development", PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });

  it("prints false for a docs-only pull request and true for a code one", () => {
    expect(run("docs", "docs/UX.md\nREADME.md\n", { CHANGED_TOTAL: "2" }).stdout.trim()).toBe("false");
    expect(run("docs", "docs/UX.md\nsrc/a.ts\n", { CHANGED_TOTAL: "2" }).stdout.trim()).toBe("true");
  });

  it("prints true when the file listing failed (empty input) or the count is missing", () => {
    expect(run("docs", "", { CHANGED_TOTAL: "" }).stdout.trim()).toBe("true");
    expect(run("docs", "docs/UX.md\n", {}).stdout.trim()).toBe("true");
  });

  it("reads the labels as exact names and treats unreadable labels as needing a run", () => {
    expect(run("perf", "docs/UX.md\n", { CHANGED_TOTAL: "1", LABELS_JSON: '["perf"]' }).stdout.trim()).toBe("true");
    expect(run("perf", "docs/UX.md\n", { CHANGED_TOTAL: "1", LABELS_JSON: '["x,perf"]' }).stdout.trim()).toBe("false");
    expect(run("perf", "docs/UX.md\n", { CHANGED_TOTAL: "1", LABELS_JSON: "not json" }).stdout.trim()).toBe("true");
  });

  it("refuses an unknown mode", () => {
    expect(run("other", "").status).toBe(2);
  });
});
