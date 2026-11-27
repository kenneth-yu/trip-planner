import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const MARKER = "<!-- trip-planner-perf -->";
const DIR = path.join(".next", "perf");

const Measurements = z.array(z.object({ name: z.string(), medianMs: z.number(), budgetMs: z.number(), samples: z.number() }));
const Audit = z.object({ numericValue: z.number().optional(), score: z.number().nullable() });
const Lhr = z.object({
  finalDisplayedUrl: z.string(),
  categories: z.object({ performance: z.object({ score: z.number().nullable() }) }),
  audits: z.record(z.string(), Audit),
});

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function timingTable(title: string, files: string[]): string {
  const rows = files.flatMap((f) => {
    const file = path.join(DIR, `${f}.json`);
    return existsSync(file) ? Measurements.parse(readJson(file)) : [];
  });
  if (!rows.length) return `### ${title}\n\nNot run.\n`;
  const lines = rows.map((m) => `| ${m.name} | ${m.medianMs.toFixed(3)} ms | ${m.budgetMs} ms | ${m.medianMs <= m.budgetMs ? "ok" : "over"} |`);
  return [`### ${title}`, "", "| Measure | Median | Budget | Result |", "|---|---|---|---|", ...lines, ""].join("\n");
}

function lighthouseTable(preset: string): string {
  const dir = path.join(DIR, `lighthouse-${preset}`);
  if (!existsSync(dir)) return `### Lighthouse ${preset}\n\nNot run.\n`;
  const lines = readdirSync(dir)
    .filter((f) => /^lhr-.*\.json$/.test(f))
    .map((f) => Lhr.parse(readJson(path.join(dir, f))))
    .map((r) => {
      const a = r.audits;
      const url = new URL(r.finalDisplayedUrl).pathname.replace(/^\/trips\/[^/]+/, "/trips/:trip");
      const num = (id: string) => a[id]?.numericValue;
      return `| ${url} | ${Math.round((r.categories.performance.score ?? 0) * 100)} | ${Math.round(num("largest-contentful-paint") ?? 0)} ms | ${(num("cumulative-layout-shift") ?? 0).toFixed(3)} | ${Math.round(num("total-blocking-time") ?? 0)} ms | ${a["installable-manifest"]?.score === 1 ? "pass" : "fail"} |`;
    });
  return [`### Lighthouse ${preset}`, "", "| Page (every run) | Score | LCP | CLS | TBT | Installable |", "|---|---|---|---|---|---|", ...lines, ""].join("\n");
}

function bundleSection(): string {
  const file = path.join(DIR, "bundle.md");
  return `### First load JavaScript\n\n${existsSync(file) ? readFileSync(file, "utf8") : "Not run.\n"}`;
}

const body = [MARKER, "## Performance", "", timingTable("Hot paths", ["hot-paths"]), timingTable("MCP get_trip", ["mcp"]), bundleSection(), lighthouseTable("mobile"), lighthouseTable("desktop")].join("\n");
writeFileSync(path.join(DIR, "summary.md"), body);
process.stdout.write(body);
