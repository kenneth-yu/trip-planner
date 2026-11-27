import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderDocument } from "../src/domain/state/render";
import { loadMachines } from "./machines";

const target = path.resolve(import.meta.dirname, "../docs/STATECHARTS.md");

function firstDifference(expected: string, actual: string): string {
  const want = expected.split("\n");
  const have = actual.split("\n");
  const at = want.findIndex((line, i) => line !== have[i]);
  const line = at === -1 ? want.length : at;
  return `line ${line + 1}\n  generated: ${want[line] ?? "(end of file)"}\n  on disk:   ${have[line] ?? "(end of file)"}`;
}

const generated = renderDocument(await loadMachines());
if (process.argv.includes("--check")) {
  const onDisk = readFileSync(target, "utf8");
  if (onDisk !== generated) {
    console.error(`docs/STATECHARTS.md is stale. First difference at ${firstDifference(generated, onDisk)}\nRun npm run docs:statecharts and commit the result.`);
    process.exit(1);
  }
} else {
  writeFileSync(target, generated);
}
