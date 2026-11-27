import { appendFileSync, writeFileSync } from "node:fs";
import { CHECKS, describe, judge, validateBase } from "./prod-smoke-lib.mjs";

const anyHost = process.argv.includes("--allow-any-host");
const checked = validateBase(process.env.SMOKE_URL, { anyHost });
if (!checked.ok) {
  process.stderr.write(`The production address was refused: ${checked.reason}.\n`);
  process.exit(2);
}

async function ask(path) {
  try {
    const response = await fetch(`${checked.base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(20000), headers: { "user-agent": "trip-planner-prod-smoke" } });
    await response.arrayBuffer();
    return { path, status: response.status };
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "TypeError")) return { path, status: null };
    throw error;
  }
}

const results = [];
for (const check of CHECKS) results.push(await ask(check.path));
const verdict = judge(results);
const table = describe(verdict);
process.stdout.write(`${table}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Production smoke test\n\n${table}\n`);
if (process.env.SMOKE_REPORT) writeFileSync(process.env.SMOKE_REPORT, `${table}\n`);
process.exit(verdict.ok ? 0 : 1);
