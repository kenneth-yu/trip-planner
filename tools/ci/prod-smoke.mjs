import { appendFileSync, writeFileSync } from "node:fs";
import { describe, judge, runSmoke, validateBase } from "./prod-smoke-lib.mjs";

function report(text) {
  process.stdout.write(`${text}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Production smoke test\n\n${text}\n`);
  if (process.env.SMOKE_REPORT) writeFileSync(process.env.SMOKE_REPORT, `${text}\n`);
}

const checked = validateBase(process.env.SMOKE_URL);
if (!checked.ok) {
  report(`The smoke test did not run: the address was refused (${checked.reason}).`);
  process.exit(2);
}

try {
  const verdict = judge(await runSmoke(checked.base));
  report(describe(verdict));
  process.exit(verdict.ok ? 0 : 1);
} catch (error) {
  report(`The smoke test crashed (${error instanceof Error ? error.name : "unknown error"}), so production could not be checked.`);
  process.exit(1);
}
