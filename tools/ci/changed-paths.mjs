import { readFileSync } from "node:fs";
import { codeChanged, perfNeeded } from "./changed-paths-lib.mjs";

const mode = process.argv[2];
if (mode !== "docs" && mode !== "perf") {
  process.stderr.write("Usage: node tools/ci/changed-paths.mjs docs|perf   (file names on stdin; CHANGED_TOTAL and LABELS_JSON in the environment)\n");
  process.exit(2);
}

const files = readFileSync(0, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);
const total = Number.parseInt(process.env.CHANGED_TOTAL ?? "", 10);

function parseLabels() {
  try {
    const parsed = JSON.parse(process.env.LABELS_JSON ?? "[]");
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

if (mode === "docs") {
  process.stdout.write(`${codeChanged({ files, total })}\n`);
} else {
  const labels = parseLabels();
  process.stdout.write(`${labels === null ? true : perfNeeded({ files, total, labels })}\n`);
}
