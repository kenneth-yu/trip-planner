import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const MARKER = "<!-- trip-planner-perf -->";
const DIR = path.join(".next", "perf");

const Measurements = z.array(z.object({ name: z.string(), medianMs: z.number().nullable(), budgetMs: z.number(), samples: z.number(), status: z.string().optional() }));
const Audit = z.object({ numericValue: z.number().optional() });
const Lhr = z.object({
  requestedUrl: z.string(),
  finalDisplayedUrl: z.string(),
  categories: z.object({ performance: z.object({ score: z.number().nullable() }) }),
  audits: z.record(z.string(), Audit),
});
export type Report = z.infer<typeof Lhr>;

export function isReportFile(name: string): boolean {
  return /\.report\.json$/.test(name);
}

export function parseReport(json: string): Report {
  return Lhr.parse(JSON.parse(json));
}

export function redirected(r: Report): boolean {
  return new URL(r.requestedUrl).pathname !== new URL(r.finalDisplayedUrl).pathname;
}

function pagePath(r: Report): string {
  return new URL(r.finalDisplayedUrl).pathname.replace(/^\/trips\/[^/]+/, "/trips/:trip");
}

export function lighthouseRows(reports: Report[]): string[] {
  return reports.map((r) => {
    const num = (id: string) => r.audits[id]?.numericValue ?? 0;
    return `| ${pagePath(r)} | ${Math.round((r.categories.performance.score ?? 0) * 100)} | ${Math.round(num("largest-contentful-paint"))} ms | ${num("cumulative-layout-shift").toFixed(3)} | ${Math.round(num("total-blocking-time"))} ms | ${redirected(r) ? "redirected" : "ok"} |`;
  });
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function timingRow(m: { name: string; medianMs: number | null; budgetMs: number; samples: number; status?: string | undefined }): string {
  if (m.medianMs === null) return `| ${m.name} | ${m.status ?? "failed"} (${m.samples} samples) | ${m.budgetMs} ms | failed |`;
  return `| ${m.name} | ${m.medianMs.toFixed(3)} ms | ${m.budgetMs} ms | ${m.medianMs <= m.budgetMs ? "ok" : "over"} |`;
}

function timingTable(title: string, files: string[]): string {
  const rows = files.flatMap((f) => {
    const file = path.join(DIR, `${f}.json`);
    return existsSync(file) ? Measurements.parse(readJson(file)) : [];
  });
  if (!rows.length) return `### ${title}\n\nNot run.\n`;
  const lines = rows.map(timingRow);
  return [`### ${title}`, "", "| Measure | Median | Budget | Result |", "|---|---|---|---|", ...lines, ""].join("\n");
}

function reportsIn(preset: string): Report[] | null {
  const dir = path.join(DIR, `lighthouse-${preset}`);
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter(isReportFile)
    .map((f) => parseReport(readFileSync(path.join(dir, f), "utf8")));
}

function lighthouseTable(preset: string, reports: Report[] | null): string {
  if (!reports?.length) return `### Lighthouse ${preset}\n\nNot run.\n`;
  return [`### Lighthouse ${preset}`, "", "| Page (every run) | Score | LCP | CLS | TBT | Signed in |", "|---|---|---|---|---|---|", ...lighthouseRows(reports), ""].join("\n");
}

function bundleSection(): string {
  const file = path.join(DIR, "bundle.md");
  return `### First load JavaScript\n\n${existsSync(file) ? readFileSync(file, "utf8") : "Not run.\n"}`;
}

function main(): void {
  const mobile = reportsIn("mobile");
  const desktop = reportsIn("desktop");
  const body = [MARKER, "## Performance", "", timingTable("Hot paths", ["hot-paths"]), timingTable("MCP get_trip", ["mcp"]), bundleSection(), lighthouseTable("mobile", mobile), lighthouseTable("desktop", desktop)].join("\n");
  writeFileSync(path.join(DIR, "summary.md"), body);
  process.stdout.write(body);
  const bounced = [...(mobile ?? []), ...(desktop ?? [])].filter(redirected);
  if (bounced.length) {
    console.error(`${bounced.length} Lighthouse run(s) were redirected away from the page they asked for, so they did not measure a signed in page. Check that the session cookie is sent.`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
