import { parseArgs } from "node:util";
import { getDb } from "../src/server/db/client";
import { failureMessage } from "../src/server/script-failure";
import { assertSeedAllowed, SeedRefused, seedEverything } from "../src/server/seed";

const { values } = parseArgs({ options: { "preview-database": { type: "boolean", default: false } } });

let exitCode = 0;
try {
  assertSeedAllowed(process.env, values["preview-database"]);
  const { created, skipped } = await seedEverything(await getDb(), process.env, values["preview-database"]);
  for (const name of created) process.stdout.write(`Added ${name}\n`);
  for (const name of skipped) process.stdout.write(`Already there: ${name}\n`);
} catch (e) {
  process.stderr.write(e instanceof SeedRefused ? `${e.message}\n` : failureMessage("Seeding", e));
  exitCode = 1;
}
process.exit(exitCode);
