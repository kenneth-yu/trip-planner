import { parseArgs } from "node:util";
import { getDb } from "../src/server/db/client";
import { assertImportAllowed, formatImportSummary, ImportRefused, importDecemberTrip } from "../src/server/import-trip";
import { failureMessage } from "../src/server/script-failure";

const { values } = parseArgs({
  options: {
    "owner-email": { type: "string" },
    "allow-production": { type: "boolean", default: false },
  },
});

const ownerEmail = values["owner-email"];
if (!ownerEmail) {
  process.stderr.write("Usage: npm run trip:import -- --owner-email <email> [--allow-production]\n");
  process.exit(1);
}

let exitCode = 0;
try {
  const options = { ownerEmail, allowProduction: values["allow-production"], env: process.env };
  assertImportAllowed(options);
  const summary = await importDecemberTrip(await getDb(), options);
  process.stdout.write(formatImportSummary(summary));
} catch (e) {
  process.stderr.write(e instanceof ImportRefused ? `${e.message}\n` : failureMessage("Import", e));
  exitCode = 1;
}
process.exit(exitCode);
