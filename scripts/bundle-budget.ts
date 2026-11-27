import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { budgets } from "../perf/budgets";

const BuildManifest = z.object({ rootMainFiles: z.array(z.string()) });
const AppPathRoutes = z.record(z.string(), z.string());
const ClientManifest = z.object({ entryJSFiles: z.record(z.string(), z.array(z.string())) });

export function parseBuildManifest(json: string): { rootMainFiles: string[] } {
  return BuildManifest.parse(JSON.parse(json));
}

export function parseClientReferenceManifest(source: string): { entry: string; jsFiles: string[] } {
  const assignment = /__RSC_MANIFEST\[("(?:[^"\\]|\\.)*")\]\s*=\s*/.exec(source);
  if (!assignment) throw new Error("This is not a client reference manifest: no __RSC_MANIFEST assignment found.");
  const entry = z.string().parse(JSON.parse(assignment[1] ?? ""));
  const body = source.slice(assignment.index + assignment[0].length).trim().replace(/;$/, "");
  const parsed = ClientManifest.parse(JSON.parse(body));
  const files = new Set<string>();
  for (const list of Object.values(parsed.entryJSFiles)) for (const file of list) if (file.endsWith(".js")) files.add(file);
  return { entry, jsFiles: [...files] };
}

export function firstLoadFiles(build: { rootMainFiles: string[] }, client: { jsFiles: string[] }): string[] {
  return [...new Set([...build.rootMainFiles, ...client.jsFiles])].sort();
}

export function routeFromEntry(entry: string): string {
  const route = entry.replace(/\/(page|route)$/, "");
  return route === "" ? "/" : route;
}

export interface RouteSize {
  route: string;
  files: number;
  gzipBytes: number;
  budgetGzipBytes: number | null;
}

export function gzipSizeOf(file: string): number {
  return gzipSync(readFileSync(file)).length;
}

export function measureRoutes(distDir: string): RouteSize[] {
  const routes = AppPathRoutes.parse(JSON.parse(readFileSync(path.join(distDir, "app-path-routes-manifest.json"), "utf8")));
  const sizes: RouteSize[] = [];
  for (const entry of Object.keys(routes)) {
    if (!entry.endsWith("/page")) continue;
    const dir = path.join(distDir, "server", "app", entry.slice(0, -"/page".length));
    const client = parseClientReferenceManifest(readFileSync(path.join(dir, "page_client-reference-manifest.js"), "utf8"));
    const build = parseBuildManifest(readFileSync(path.join(dir, "page", "build-manifest.json"), "utf8"));
    const files = firstLoadFiles(build, client);
    const route = routeFromEntry(entry);
    sizes.push({ route, files: files.length, gzipBytes: files.reduce((sum, f) => sum + gzipSizeOf(path.join(distDir, f)), 0), budgetGzipBytes: budgets.bundle[route]?.budgetGzipBytes ?? null });
  }
  return sizes.sort((a, b) => a.route.localeCompare(b.route));
}

export function violations(sizes: RouteSize[], budgeted: string[]): string[] {
  const problems: string[] = [];
  for (const s of sizes) {
    if (s.budgetGzipBytes === null) problems.push(`${s.route} has no budget. Add it to bundle in perf/budgets.json with a measured size.`);
    else if (s.gzipBytes > s.budgetGzipBytes) problems.push(`${s.route} loads ${s.gzipBytes} bytes of gzipped JavaScript, over its ${s.budgetGzipBytes} byte budget.`);
  }
  const present = new Set(sizes.map((s) => s.route));
  for (const route of budgeted) if (!present.has(route)) problems.push(`perf/budgets.json budgets ${route}, which is not a route in this build. Remove it or rename it.`);
  return problems;
}

export function markdownTable(sizes: RouteSize[]): string {
  const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
  const rows = sizes.map((s) => `| ${s.route} | ${s.files} | ${kb(s.gzipBytes)} | ${s.budgetGzipBytes === null ? "none" : kb(s.budgetGzipBytes)} |`);
  return ["| Route | Files | First load JS (gzip) | Budget |", "|---|---|---|---|", ...rows, ""].join("\n");
}

function main(): void {
  const sizes = measureRoutes(".next");
  const problems = violations(sizes, Object.keys(budgets.bundle));
  const outDir = path.join(".next", "perf");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "bundle.json"), `${JSON.stringify(sizes, null, 2)}\n`);
  writeFileSync(path.join(outDir, "bundle.md"), markdownTable(sizes));
  process.stdout.write(markdownTable(sizes));
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
