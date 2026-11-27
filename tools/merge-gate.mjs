import { execFileSync } from "node:child_process";
import { evaluate } from "./merge-gate-lib.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const number = args.find((arg) => /^\d+$/.test(arg));
if (!number) {
  process.stderr.write("Usage: node tools/merge-gate.mjs <pr number> [--dry-run]\n");
  process.exit(2);
}

function gh(parameters) {
  return execFileSync("gh", parameters, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const pr = JSON.parse(gh(["pr", "view", number, "--json", "number,state,baseRefName,headRefOid,files,comments,commits,statusCheckRollup"]));
if (pr.state !== "OPEN") {
  process.stderr.write(`Pull request ${number} is ${pr.state.toLowerCase()}, not open.\n`);
  process.exit(1);
}
if (pr.baseRefName !== "main") {
  process.stderr.write(`Pull request ${number} targets ${pr.baseRefName}, not main.\n`);
  process.exit(1);
}

const compare = JSON.parse(gh(["api", `repos/{owner}/{repo}/compare/main...${pr.headRefOid}`, "--jq", "{behindBy: .behind_by}"]));
const verdict = evaluate({
  files: pr.files,
  comments: pr.comments,
  commits: pr.commits,
  statusCheckRollup: pr.statusCheckRollup,
  behindBy: compare.behindBy,
});

if (!verdict.ok) {
  process.stderr.write(`Not merging pull request ${number}:\n${verdict.reasons.map((reason) => `- ${reason}`).join("\n")}\n`);
  process.exit(1);
}

if (dryRun) {
  process.stdout.write(`Pull request ${number} passes the merge gate at ${pr.headRefOid}. Dry run, not merging.\n`);
  process.exit(0);
}

gh(["pr", "merge", number, "--merge", "--delete-branch", "--match-head-commit", pr.headRefOid]);
process.stdout.write(`Merged pull request ${number} at ${pr.headRefOid}.\n`);
