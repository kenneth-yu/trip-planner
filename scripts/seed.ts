import { getDb } from "../src/server/db/client";
import { seedEverything } from "../src/server/seed";

const db = await getDb();
const { created, skipped } = await seedEverything(db);
for (const name of created) process.stdout.write(`Added ${name}\n`);
for (const name of skipped) process.stdout.write(`Already there: ${name}\n`);
process.exit(0);
