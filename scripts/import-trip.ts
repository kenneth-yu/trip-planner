import { parseArgs } from "node:util";
import { getDb } from "../src/server/db/client";
import { formatImportSummary, ImportRefused, importDecemberTrip } from "../src/server/import-trip";

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

try {
  const db = await getDb();
  const summary = await importDecemberTrip(db, { ownerEmail, allowProduction: values["allow-production"], env: process.env });
  process.stdout.write(formatImportSummary(summary));
  process.exit(0);
} catch (e) {
  if (!(e instanceof ImportRefused)) throw e;
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
