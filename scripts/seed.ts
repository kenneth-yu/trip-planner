import { getDb } from "../src/server/db/client";
import { seedFixtureTrip } from "../src/server/seed";

const db = await getDb();
const { tripId } = await seedFixtureTrip(db, { withItems: process.argv.includes("--empty") ? false : true });
process.stdout.write(`Seeded the December fixture trip: /trips/${tripId}\n`);
process.exit(0);
